import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import {
  serviceScheduleMonitorLeases,
  serviceScheduleRuns,
  serviceSchedules
} from "../db/schema/service-schedules";
import {
  acquireServiceScheduleMonitorLease,
  getServiceScheduleMonitorLeaseStatus,
  releaseServiceScheduleMonitorLease
} from "../db/services/service-schedule-lease";
import { createServiceSchedule } from "../db/services/service-schedules";
import {
  createProjectEnvironmentServiceFixture,
  foundationOwnerRequester
} from "../testing/project-fixtures";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import {
  getServiceScheduleMonitorInstanceId,
  getServiceScheduleMonitorRuntimeStatus,
  runServiceScheduleMonitorCycle,
  startServiceScheduleMonitor,
  stopServiceScheduleMonitor
} from "./service-schedule-monitor";
import {
  resetServiceScheduleCommandRunnerForTests,
  setServiceScheduleCommandRunnerForTests
} from "./service-schedule-runner";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForActiveLease() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await getServiceScheduleMonitorLeaseStatus();
    if (status?.active) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return getServiceScheduleMonitorLeaseStatus();
}

async function waitForReleasedLease() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await getServiceScheduleMonitorLeaseStatus();
    if (status && !status.active) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return getServiceScheduleMonitorLeaseStatus();
}

async function createDueSchedule() {
  const suffix = Date.now().toString(36);
  const fixture = await createProjectEnvironmentServiceFixture({
    project: { name: `Monitor project ${suffix}`, teamId: "team_foundation" },
    environment: { name: `monitor-${suffix}`, targetServerId: "srv_foundation_1" },
    service: {
      name: `monitor-service-${suffix}`,
      sourceType: "compose",
      targetServerId: "srv_foundation_1"
    }
  });
  const result = await createServiceSchedule({
    serviceId: fixture.service.id,
    teamId: "team_foundation",
    name: "Monitor schedule",
    command: "echo scheduled",
    cronExpression: "*/5 * * * *",
    timezone: "UTC",
    actor: foundationOwnerRequester
  });
  if (result.status !== "ok") throw new Error("Unable to create monitor test schedule.");

  await db.insert(deployments).values({
    id: `mondep${suffix}`.slice(0, 32),
    projectId: fixture.project.id,
    environmentId: fixture.environment.id,
    targetServerId: "srv_foundation_1",
    serviceId: fixture.service.id,
    serviceName: fixture.service.name,
    sourceType: fixture.service.sourceType,
    configSnapshot: {
      projectName: `monitor_${fixture.service.slug}`,
      composeServiceName: fixture.service.composeServiceName ?? fixture.service.name
    },
    status: "completed",
    conclusion: "succeeded",
    trigger: "user"
  });

  const scheduledFor = new Date("2026-01-01T00:00:00.000Z");
  await db
    .update(serviceSchedules)
    .set({ nextRunAt: scheduledFor })
    .where(eq(serviceSchedules.id, result.schedule.id));

  return { schedule: result.schedule, scheduledFor };
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

describe("service schedule monitor", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(async () => {
    resetServiceScheduleCommandRunnerForTests();
    await stopServiceScheduleMonitor();
    const status = await getServiceScheduleMonitorLeaseStatus();
    if (status?.active) await releaseServiceScheduleMonitorLease(status);
    await waitForReleasedLease();
  });

  it("exposes one-cycle lease ownership and runtime status", async () => {
    const result = await runServiceScheduleMonitorCycle({ instanceId: "monitor-cycle-a" });

    expect(result).toMatchObject({
      instanceId: "monitor-cycle-a",
      lease: { holderInstanceId: "monitor-cycle-a" },
      leaseLost: false
    });
    expect(getServiceScheduleMonitorInstanceId()).not.toBe("");
    expect(getServiceScheduleMonitorRuntimeStatus()).toMatchObject({
      cycleInProgress: false,
      activeLease: { holderInstanceId: "monitor-cycle-a" },
      lastResult: { instanceId: "monitor-cycle-a" }
    });
  });

  it("records one due occurrence when concurrent monitor instances race without running it", async () => {
    const { schedule, scheduledFor } = await createDueSchedule();
    const results = await Promise.all([
      runServiceScheduleMonitorCycle({
        instanceId: "monitor-race-a",
        runLimit: 0
      }),
      runServiceScheduleMonitorCycle({
        instanceId: "monitor-race-b",
        runLimit: 0
      })
    ]);

    expect(results.filter((result) => result.lease)).toHaveLength(1);
    expect(results.reduce((total, result) => total + result.queuedOccurrences, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.processedRuns, 0)).toBe(0);

    const winner = results.find((result) => result.lease)!;
    const runs = await listScheduledRuns(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      scheduledFor,
      status: "queued",
      command: "echo scheduled",
      leaseGeneration: winner.lease!.generation,
      leaseHolderInstanceId: winner.lease!.holderInstanceId,
      runnerInstanceId: winner.lease!.holderInstanceId,
      startedAt: null,
      finishedAt: null
    });
  });

  it("takes over an expired holder with a higher generation and rejects the stale holder", async () => {
    const { schedule } = await createDueSchedule();
    const staleLease = await acquireServiceScheduleMonitorLease({
      holderInstanceId: "monitor-expired"
    });
    expect(staleLease).not.toBeNull();

    await db
      .update(serviceScheduleMonitorLeases)
      .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(serviceScheduleMonitorLeases.key, staleLease!.key));

    const takeover = await runServiceScheduleMonitorCycle({
      instanceId: "monitor-takeover",
      runLimit: 0
    });
    expect(takeover).toMatchObject({
      lease: {
        holderInstanceId: "monitor-takeover",
        generation: staleLease!.generation + 1
      },
      queuedOccurrences: 1,
      processedRuns: 0,
      leaseLost: false
    });

    const staleAttempt = await runServiceScheduleMonitorCycle({
      instanceId: "monitor-expired",
      runLimit: 0
    });
    expect(staleAttempt).toMatchObject({
      lease: null,
      queuedOccurrences: 0,
      processedRuns: 0,
      leaseLost: false
    });
    expect(await listScheduledRuns(schedule.id)).toHaveLength(1);
  });

  it("keeps leadership while a scheduled command runs longer than the lease TTL", async () => {
    await createDueSchedule();
    const commandStarted = createDeferred();
    const finishCommand = createDeferred();
    setServiceScheduleCommandRunnerForTests(async () => {
      commandStarted.resolve();
      await finishCommand.promise;
      return { exitCode: 0, logs: "completed", timedOut: false };
    });

    const cycle = runServiceScheduleMonitorCycle({
      instanceId: "monitor-heartbeat",
      leaseDurationMs: 150,
      runLimit: 1
    });
    await commandStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 350));

    await expect(
      acquireServiceScheduleMonitorLease({
        holderInstanceId: "monitor-competitor",
        leaseDurationMs: 150
      })
    ).resolves.toBeNull();
    expect(await getServiceScheduleMonitorLeaseStatus()).toMatchObject({
      active: true,
      holderInstanceId: "monitor-heartbeat"
    });

    finishCommand.resolve();
    await expect(cycle).resolves.toMatchObject({
      processedRuns: 1,
      leaseLost: false
    });
  });

  it("releases its active generation on graceful stop", async () => {
    startServiceScheduleMonitor({ pollIntervalMs: 1_000 });
    expect(await waitForActiveLease()).toMatchObject({
      active: true,
      holderInstanceId: getServiceScheduleMonitorInstanceId()
    });

    await stopServiceScheduleMonitor();

    expect(await waitForReleasedLease()).toMatchObject({ active: false, expiresInMs: 0 });
    expect(getServiceScheduleMonitorRuntimeStatus()).toMatchObject({
      running: false,
      cycleInProgress: false,
      activeLease: null
    });
  });
});
