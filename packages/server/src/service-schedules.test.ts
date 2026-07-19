import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { deployments } from "./db/schema/deployments";
import { notificationChannels, notificationLogs } from "./db/schema/notifications";
import { serviceScheduleRuns } from "./db/schema/service-schedules";
import { computeNextRunAt } from "./db/services/service-schedule-cron";
import { acquireServiceScheduleMonitorLease } from "./db/services/service-schedule-lease";
import {
  createDueServiceScheduleRuns,
  createServiceScheduleRun
} from "./db/services/service-schedules";
import {
  createProjectEnvironmentServiceFixture,
  foundationOwnerRequester
} from "./testing/project-fixtures";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { makeSession } from "./testing/request-auth-fixtures";
import { appRouter } from "./router";
import {
  resetServiceScheduleCommandRunnerForTests,
  setServiceScheduleCommandRunnerForTests
} from "./worker";

async function createFixture() {
  const suffix = Date.now().toString(36);
  return createProjectEnvironmentServiceFixture({
    project: {
      name: `Schedule Project ${suffix}`,
      description: "Schedule test project",
      teamId: "team_foundation"
    },
    environment: {
      name: `production-${suffix}`,
      targetServerId: "srv_foundation_1"
    },
    service: {
      name: `schedule-svc-${suffix}`,
      sourceType: "compose",
      targetServerId: "srv_foundation_1"
    }
  });
}

async function createSuccessfulDeployment(fixture: Awaited<ReturnType<typeof createFixture>>) {
  await db.insert(deployments).values({
    id: `scheddep${Date.now().toString(36)}`.slice(0, 32),
    projectId: fixture.project.id,
    environmentId: fixture.environment.id,
    targetServerId: "srv_foundation_1",
    serviceId: fixture.service.id,
    serviceName: fixture.service.name,
    sourceType: fixture.service.sourceType,
    configSnapshot: {
      projectName: `sched_${fixture.service.slug}`,
      composeServiceName: fixture.service.composeServiceName ?? fixture.service.name
    },
    status: "completed",
    conclusion: "succeeded",
    trigger: "user"
  });
}

function caller() {
  return appRouter.createCaller({
    requestId: "service-schedules-test",
    session: makeSession("owner")
  });
}

describe("service schedules", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    setServiceScheduleCommandRunnerForTests(({ command }) =>
      Promise.resolve({
        exitCode: command.includes("__DAOFLOW_SCHEDULE_FAIL__") ? 1 : 0,
        logs: "fake schedule command output",
        timedOut: false
      })
    );
  });

  afterEach(() => {
    resetServiceScheduleCommandRunnerForTests();
  });

  it("computes cron schedules in the configured timezone", () => {
    const nextRun = computeNextRunAt(
      "0 9 * * *",
      new Date("2026-01-01T12:00:00.000Z"),
      "America/New_York"
    );

    expect(nextRun.toISOString()).toBe("2026-01-01T14:00:00.000Z");
  });

  it("reports the active scheduler lease to service readers", async () => {
    const lease = await acquireServiceScheduleMonitorLease({
      holderInstanceId: "monitor-status-a"
    });
    expect(lease).not.toBeNull();

    const status = await caller().serviceScheduleMonitorStatus();

    expect(status).toMatchObject({
      holderInstanceId: "monitor-status-a",
      generation: lease!.generation,
      active: true
    });
    expect(status?.leaseAgeMs).toBeGreaterThanOrEqual(0);
  });

  it("creates, pauses, resumes, runs, deletes, and audits service schedules", async () => {
    const fixture = await createFixture();
    await createSuccessfulDeployment(fixture);
    const api = caller();

    const schedule = await api.createServiceSchedule({
      serviceId: fixture.service.id,
      name: "Cache warmer",
      command: "bun run warm-cache",
      cronExpression: "*/10 * * * *",
      timezone: "UTC"
    });

    expect(schedule).toMatchObject({
      serviceId: fixture.service.id,
      name: "Cache warmer",
      status: "active",
      enabled: true
    });
    expect(schedule.nextRunAt).toBeTruthy();

    const list = await api.serviceSchedules({ serviceId: fixture.service.id });
    expect(list.map((entry) => entry.id)).toContain(schedule.id);

    const paused = await api.setServiceScheduleState({ scheduleId: schedule.id, state: "pause" });
    expect(paused.status).toBe("paused");
    expect(paused.nextRunAt).toBeNull();

    const resumed = await api.setServiceScheduleState({ scheduleId: schedule.id, state: "resume" });
    expect(resumed.status).toBe("active");
    expect(resumed.nextRunAt).toBeTruthy();

    const run = await api.runServiceScheduleNow({ scheduleId: schedule.id });
    expect(run.status).toBe("succeeded");
    expect(run.logs).toContain("Service schedule runner accepted");

    const history = await api.serviceScheduleRuns({ scheduleId: schedule.id });
    expect(history.runs[0]?.id).toBe(run.id);

    const deleted = await api.deleteServiceSchedule({ scheduleId: schedule.id });
    expect(deleted).toEqual({ status: "ok", scheduleId: schedule.id });

    const auditRows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `service_schedule/${schedule.id}`));
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "service_schedule.create",
        "service_schedule.pause",
        "service_schedule.resume",
        "service_schedule.run_manual",
        "service_schedule.delete"
      ])
    );
  });

  it("rejects invalid cron input and records failed-run notifications", async () => {
    const fixture = await createFixture();
    await createSuccessfulDeployment(fixture);
    const api = caller();

    await expect(
      api.createServiceSchedule({
        serviceId: fixture.service.id,
        name: "Invalid",
        command: "echo ok",
        cronExpression: "* * *",
        timezone: "UTC"
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await db.insert(notificationChannels).values({
      id: "notif_schedule_failed",
      teamId: "team_foundation",
      name: "Schedule failure webhook",
      channelType: "generic_webhook",
      webhookUrl: "http://127.0.0.1:9/notifications",
      eventSelectors: ["schedule.failed"],
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const schedule = await api.createServiceSchedule({
      serviceId: fixture.service.id,
      name: "Failing task",
      command: "__DAOFLOW_SCHEDULE_FAIL__",
      cronExpression: "*/5 * * * *",
      timezone: "UTC"
    });

    const run = await api.runServiceScheduleNow({ scheduleId: schedule.id });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("code 1");

    const logs = await db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.eventType, "schedule.failed"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe("failed");
  });

  it("does not enqueue duplicate scheduled runs while one is pending", async () => {
    const fixture = await createFixture();
    const api = caller();

    const schedule = await api.createServiceSchedule({
      serviceId: fixture.service.id,
      name: "Overlapping task",
      command: "echo ok",
      cronExpression: "* * * * *",
      timezone: "UTC"
    });
    const actor = {
      requestedByUserId: "service-schedule-runner",
      requestedByEmail: "service-schedule-runner@daoflow.local",
      requestedByRole: "operator"
    } as const;
    const lease = await acquireServiceScheduleMonitorLease({
      holderInstanceId: "service-schedule-test-monitor"
    });
    expect(lease).not.toBeNull();

    const firstBatch = await createDueServiceScheduleRuns({
      teamId: "team_foundation",
      now: new Date("2030-01-01T00:00:00.000Z"),
      actor,
      lease: lease!
    });
    const secondBatch = await createDueServiceScheduleRuns({
      teamId: "team_foundation",
      now: new Date("2030-01-01T00:01:00.000Z"),
      actor,
      lease: lease!
    });

    expect(firstBatch.map((run) => run.scheduleId)).toEqual([schedule.id]);
    expect(secondBatch).toHaveLength(1);
    expect(secondBatch[0]).toMatchObject({ scheduleId: schedule.id, status: "skipped" });
  });

  it("retains only the configured number of completed runs", async () => {
    const fixture = await createFixture();
    await createSuccessfulDeployment(fixture);
    const api = caller();

    const schedule = await api.createServiceSchedule({
      serviceId: fixture.service.id,
      name: "Retained task",
      command: "echo ok",
      cronExpression: "*/5 * * * *",
      timezone: "UTC",
      retentionCount: 2
    });

    await api.runServiceScheduleNow({ scheduleId: schedule.id });
    await api.runServiceScheduleNow({ scheduleId: schedule.id });
    const third = await api.runServiceScheduleNow({ scheduleId: schedule.id });

    const rows = await db
      .select()
      .from(serviceScheduleRuns)
      .where(eq(serviceScheduleRuns.scheduleId, schedule.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((run) => run.id)).toContain(third.id);
  });

  it("rolls back a manual run when writing its audit entry fails", async () => {
    const fixture = await createFixture();
    const schedule = await caller().createServiceSchedule({
      serviceId: fixture.service.id,
      name: "Atomic audit task",
      command: "echo ok",
      cronExpression: "*/5 * * * *",
      timezone: "UTC"
    });

    await expect(
      createServiceScheduleRun({
        scheduleId: schedule.id,
        teamId: "team_foundation",
        triggerKind: "manual",
        actor: {
          ...foundationOwnerRequester,
          actorType: "x".repeat(21) as "user"
        }
      })
    ).rejects.toMatchObject({ cause: { code: "22001" } });

    const runs = await db
      .select()
      .from(serviceScheduleRuns)
      .where(eq(serviceScheduleRuns.scheduleId, schedule.id));
    expect(runs).toEqual([]);

    const audits = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "service_schedule.run_manual"));
    expect(audits).toEqual([]);
  });
});
