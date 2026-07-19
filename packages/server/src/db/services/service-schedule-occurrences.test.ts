import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import {
  serviceScheduleMonitorLeases,
  serviceScheduleRuns,
  serviceSchedules
} from "../schema/service-schedules";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { createProjectEnvironmentServiceFixture } from "../../testing/project-fixtures";
import { computeNextRunAt } from "./service-schedule-cron";
import {
  acquireServiceScheduleMonitorLease,
  SERVICE_SCHEDULE_MONITOR_LEASE_KEY
} from "./service-schedule-lease";
import {
  createDueServiceScheduleRuns,
  createServiceSchedule,
  createServiceScheduleRun
} from "./service-schedules";
import {
  completeServiceScheduleRun,
  executeServiceScheduleRun,
  pollServiceScheduleRuns
} from "../../worker/service-schedule-runner";

const monitorActor = {
  requestedByUserId: "service-schedule-runner",
  requestedByEmail: "service-schedule-runner@daoflow.local",
  requestedByRole: "operator" as const,
  actorType: "system" as const
};

const ownerActor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createScheduleFixture() {
  const suffix = Date.now().toString(36);
  const fixture = await createProjectEnvironmentServiceFixture({
    project: { name: `Occurrence project ${suffix}`, teamId: "team_foundation" },
    environment: { name: `occurrence-${suffix}`, targetServerId: "srv_foundation_1" },
    service: {
      name: `occurrence-service-${suffix}`,
      sourceType: "compose",
      targetServerId: "srv_foundation_1"
    }
  });
  const result = await createServiceSchedule({
    serviceId: fixture.service.id,
    teamId: "team_foundation",
    name: "Occurrence schedule",
    command: "echo schedule",
    cronExpression: "*/5 * * * *",
    timezone: "UTC",
    actor: ownerActor
  });
  if (result.status !== "ok") throw new Error("Unable to create test schedule.");
  return { fixture, schedule: result.schedule };
}

async function forceNextRunAt(scheduleId: string, scheduledFor: Date) {
  await db
    .update(serviceSchedules)
    .set({ nextRunAt: scheduledFor, updatedAt: scheduledFor })
    .where(eq(serviceSchedules.id, scheduleId));
}

async function listScheduledRuns(scheduleId: string) {
  return db
    .select()
    .from(serviceScheduleRuns)
    .where(
      and(
        eq(serviceScheduleRuns.scheduleId, scheduleId),
        eq(serviceScheduleRuns.triggerKind, "scheduled")
      )
    );
}

describe("service schedule occurrences", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("records a due occurrence once and advances the schedule before completion", async () => {
    const { schedule } = await createScheduleFixture();
    const scheduledFor = new Date("2026-01-01T00:00:00.000Z");
    await forceNextRunAt(schedule.id, scheduledFor);
    const lease = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-a" });
    expect(lease).not.toBeNull();

    const created = await createDueServiceScheduleRuns({
      actor: monitorActor,
      lease: lease!,
      now: new Date("2026-01-01T01:00:00.000Z")
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      scheduleId: schedule.id,
      scheduledFor: scheduledFor.toISOString(),
      leaseGeneration: lease!.generation,
      leaseHolderInstanceId: "monitor-a",
      runnerInstanceId: "monitor-a",
      requestedByUserId: null,
      requestedByEmail: monitorActor.requestedByEmail,
      requestedByRole: monitorActor.requestedByRole,
      status: "queued"
    });

    const [claimedSchedule] = await db
      .select()
      .from(serviceSchedules)
      .where(eq(serviceSchedules.id, schedule.id));
    const expectedNextRunAt = computeNextRunAt("*/5 * * * *", scheduledFor, "UTC");
    expect(claimedSchedule?.nextRunAt?.toISOString()).toBe(expectedNextRunAt.toISOString());

    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "service_schedule.run_scheduled"));
    expect(audit?.inputSummary).toContain(scheduledFor.toISOString());
    expect(audit?.inputSummary).toContain("Monitor holder monitor-a generation");
    expect(audit?.actorType).toBe("system");

    await completeServiceScheduleRun({
      runId: created[0].id,
      status: "succeeded",
      logs: "completed without dispatch"
    });
    const [completedSchedule] = await db
      .select()
      .from(serviceSchedules)
      .where(eq(serviceSchedules.id, schedule.id));
    expect(completedSchedule?.nextRunAt?.toISOString()).toBe(expectedNextRunAt.toISOString());

    await expect(
      db.insert(serviceScheduleRuns).values({
        id: "duplicate_schedule_occurrence",
        scheduleId: schedule.id,
        serviceId: schedule.serviceId,
        triggerKind: "scheduled",
        scheduledFor,
        status: "queued",
        command: "echo schedule",
        logs: "duplicate",
        result: {}
      })
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("does not duplicate an occurrence when monitor clocks are slightly skewed", async () => {
    const { schedule } = await createScheduleFixture();
    const scheduledFor = new Date("2026-01-01T00:00:00.000Z");
    await forceNextRunAt(schedule.id, scheduledFor);
    const lease = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-a" });
    expect(lease).not.toBeNull();

    const batches = await Promise.all([
      createDueServiceScheduleRuns({
        actor: monitorActor,
        lease: lease!,
        now: new Date("2026-01-01T00:00:10.000Z")
      }),
      createDueServiceScheduleRuns({
        actor: monitorActor,
        lease: lease!,
        now: new Date("2026-01-01T00:00:40.000Z")
      })
    ]);

    expect(batches.flat()).toHaveLength(1);
    const occurrences = await db
      .select()
      .from(serviceScheduleRuns)
      .where(
        and(
          eq(serviceScheduleRuns.scheduleId, schedule.id),
          eq(serviceScheduleRuns.scheduledFor, scheduledFor)
        )
      );
    expect(occurrences).toHaveLength(1);
  });

  it("records later overlapping occurrences as skipped instead of queuing them", async () => {
    const { schedule } = await createScheduleFixture();
    await forceNextRunAt(schedule.id, new Date("2026-01-01T00:00:00.000Z"));
    await db
      .update(serviceSchedules)
      .set({ retentionCount: 1 })
      .where(eq(serviceSchedules.id, schedule.id));
    const lease = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-a" });
    expect(lease).not.toBeNull();

    const first = await createDueServiceScheduleRuns({
      actor: monitorActor,
      lease: lease!,
      now: new Date("2026-01-01T01:00:00.000Z")
    });
    const second = await createDueServiceScheduleRuns({
      actor: monitorActor,
      lease: lease!,
      now: new Date("2026-01-01T01:00:00.000Z")
    });
    const third = await createDueServiceScheduleRuns({
      actor: monitorActor,
      lease: lease!,
      now: new Date("2026-01-01T01:00:00.000Z")
    });

    expect(first[0]).toMatchObject({ status: "queued" });
    expect(second[0]).toMatchObject({ status: "skipped" });
    expect(third[0]).toMatchObject({ status: "skipped" });
    expect(second[0]?.logs).toContain("earlier scheduled run");
    expect(second[0]?.result).toMatchObject({ outcome: "skipped" });
    expect(second[0]).toMatchObject({
      runnerInstanceId: "monitor-a",
      requestedByUserId: null,
      requestedByEmail: monitorActor.requestedByEmail,
      requestedByRole: monitorActor.requestedByRole
    });
    const skippedRuns = await db
      .select()
      .from(serviceScheduleRuns)
      .where(
        and(
          eq(serviceScheduleRuns.scheduleId, schedule.id),
          eq(serviceScheduleRuns.status, "skipped")
        )
      );
    expect(skippedRuns).toHaveLength(1);
    expect(skippedRuns[0]?.id).toBe(third[0]?.id);
  });

  it("rejects stale lease generations before recording or dispatching work", async () => {
    const { schedule } = await createScheduleFixture();
    const scheduledFor = new Date("2026-01-01T00:00:00.000Z");
    await forceNextRunAt(schedule.id, scheduledFor);
    const firstLease = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-a" });
    expect(firstLease).not.toBeNull();
    await db
      .update(serviceScheduleMonitorLeases)
      .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(serviceScheduleMonitorLeases.key, SERVICE_SCHEDULE_MONITOR_LEASE_KEY));
    const replacementLease = await acquireServiceScheduleMonitorLease({
      holderInstanceId: "monitor-b"
    });
    expect(replacementLease?.generation).toBe(firstLease!.generation + 1);

    const staleCreated = await createDueServiceScheduleRuns({
      actor: monitorActor,
      lease: firstLease!,
      now: new Date("2026-01-01T01:00:00.000Z")
    });
    expect(staleCreated).toEqual([]);

    const [scheduleAfterStaleClaim] = await db
      .select()
      .from(serviceSchedules)
      .where(eq(serviceSchedules.id, schedule.id));
    expect(scheduleAfterStaleClaim?.nextRunAt?.toISOString()).toBe(scheduledFor.toISOString());

    const manual = await createServiceScheduleRun({
      scheduleId: schedule.id,
      teamId: "team_foundation",
      triggerKind: "manual",
      actor: ownerActor
    });
    if (manual.status !== "ok") throw new Error("Unable to queue manual test run.");
    expect(
      await executeServiceScheduleRun(manual.run.id, {
        lease: firstLease!,
        triggerKind: "scheduled"
      })
    ).toBeNull();
    const [queuedManual] = await db
      .select()
      .from(serviceScheduleRuns)
      .where(eq(serviceScheduleRuns.id, manual.run.id));
    expect(queuedManual).toMatchObject({ status: "queued", runnerInstanceId: null });
  });

  it("allows lease takeover while a stale occurrence claim waits on the schedule lock", async () => {
    const { schedule } = await createScheduleFixture();
    const scheduledFor = new Date("2026-01-01T00:00:00.000Z");
    await forceNextRunAt(schedule.id, scheduledFor);
    const staleLease = await acquireServiceScheduleMonitorLease({
      holderInstanceId: "monitor-lock-stale",
      leaseDurationMs: 150
    });
    expect(staleLease).not.toBeNull();

    const lockAcquired = createDeferred();
    const releaseLock = createDeferred();
    const blocker = db.transaction(async (tx) => {
      await tx
        .select({ id: serviceSchedules.id })
        .from(serviceSchedules)
        .where(eq(serviceSchedules.id, schedule.id))
        .for("update");
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    await lockAcquired.promise;

    const staleClaim = createDueServiceScheduleRuns({
      actor: monitorActor,
      lease: staleLease!,
      now: new Date("2026-01-01T01:00:00.000Z")
    });
    await new Promise((resolve) => setTimeout(resolve, 225));

    const takeover = await Promise.race([
      acquireServiceScheduleMonitorLease({
        holderInstanceId: "monitor-lock-takeover",
        leaseDurationMs: 1_000
      }),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 300))
    ]);
    expect(takeover).not.toBe("timed-out");
    expect(takeover).toMatchObject({
      holderInstanceId: "monitor-lock-takeover",
      generation: staleLease!.generation + 1
    });

    releaseLock.resolve();
    await blocker;
    await expect(staleClaim).resolves.toEqual([]);
    expect(await listScheduledRuns(schedule.id)).toHaveLength(0);
  });

  it("keeps manual runs outside scheduled occurrence and lease metadata", async () => {
    const { schedule } = await createScheduleFixture();
    const first = await createServiceScheduleRun({
      scheduleId: schedule.id,
      teamId: "team_foundation",
      triggerKind: "manual",
      actor: ownerActor
    });
    const second = await createServiceScheduleRun({
      scheduleId: schedule.id,
      teamId: "team_foundation",
      triggerKind: "manual",
      actor: ownerActor
    });
    if (first.status !== "ok" || second.status !== "ok") {
      throw new Error("Unable to queue manual test runs.");
    }

    const runs = await db
      .select()
      .from(serviceScheduleRuns)
      .where(
        and(
          eq(serviceScheduleRuns.scheduleId, schedule.id),
          eq(serviceScheduleRuns.triggerKind, "manual")
        )
      );
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scheduledFor: null,
          leaseGeneration: null,
          leaseHolderInstanceId: null
        }),
        expect.objectContaining({
          scheduledFor: null,
          leaseGeneration: null,
          leaseHolderInstanceId: null
        })
      ])
    );
  });

  it("keeps an older manual run queued while a leased scheduler claims a due occurrence", async () => {
    const { schedule } = await createScheduleFixture();
    const manual = await createServiceScheduleRun({
      scheduleId: schedule.id,
      teamId: "team_foundation",
      triggerKind: "manual",
      actor: ownerActor
    });
    if (manual.status !== "ok") throw new Error("Unable to queue manual test run.");
    await db
      .update(serviceScheduleRuns)
      .set({ createdAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(serviceScheduleRuns.id, manual.run.id));

    const lease = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-poll-a" });
    expect(lease).not.toBeNull();
    const scheduledFor = new Date("2026-01-01T00:00:00.000Z");
    await forceNextRunAt(schedule.id, scheduledFor);
    const occurrences = await createDueServiceScheduleRuns({
      actor: monitorActor,
      lease: lease!,
      now: new Date("2026-01-01T01:00:00.000Z")
    });
    expect(occurrences).toHaveLength(1);

    await expect(pollServiceScheduleRuns({ lease: lease!, limit: 1 })).resolves.toEqual({
      processed: 1,
      leaseLost: false
    });

    const [queuedManual] = await db
      .select()
      .from(serviceScheduleRuns)
      .where(eq(serviceScheduleRuns.id, manual.run.id));
    expect(queuedManual).toMatchObject({ status: "queued", triggerKind: "manual" });

    const [claimedScheduled] = await db
      .select()
      .from(serviceScheduleRuns)
      .where(eq(serviceScheduleRuns.id, occurrences[0].id));
    expect(claimedScheduled).toMatchObject({ triggerKind: "scheduled", status: "failed" });
  });

  it("keeps manual and scheduler claims isolated when they race", async () => {
    const { schedule } = await createScheduleFixture();
    const manual = await createServiceScheduleRun({
      scheduleId: schedule.id,
      teamId: "team_foundation",
      triggerKind: "manual",
      actor: ownerActor
    });
    if (manual.status !== "ok") throw new Error("Unable to queue manual test run.");
    const lease = await acquireServiceScheduleMonitorLease({ holderInstanceId: "monitor-race-a" });
    expect(lease).not.toBeNull();

    const [schedulerClaim, manualClaim] = await Promise.all([
      executeServiceScheduleRun(manual.run.id, {
        lease: lease!,
        triggerKind: "scheduled"
      }),
      executeServiceScheduleRun(manual.run.id, { triggerKind: "manual" })
    ]);

    expect(schedulerClaim).toBeNull();
    expect(manualClaim).toMatchObject({ id: manual.run.id, triggerKind: "manual" });
  });
});
