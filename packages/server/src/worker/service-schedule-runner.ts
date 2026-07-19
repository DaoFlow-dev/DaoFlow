import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { environments, projects } from "../db/schema/projects";
import { serviceScheduleRuns, serviceSchedules } from "../db/schema/service-schedules";
import { services } from "../db/schema/services";
import { resolveServiceRuntime } from "../db/services/service-runtime";
import {
  isCurrentServiceScheduleMonitorLease,
  SERVICE_SCHEDULE_MONITOR_LEASE_KEY,
  type ServiceScheduleMonitorLease
} from "../db/services/service-schedule-lease";
import { pruneServiceScheduleRuns } from "../db/services/service-schedule-occurrences";
import { serializeServiceScheduleRun } from "../db/services/service-schedule-serialization";
import { runServiceCommand, type ServiceCommandResult } from "./service-command-runner";
import { dispatchNotification } from "./temporal/activities/notification-activities";

type ScheduleCommandRunner = typeof runServiceCommand;
let scheduleCommandRunner: ScheduleCommandRunner = runServiceCommand;
const defaultRunConcurrency = 4;

export type ServiceScheduleRunnerLease = Pick<
  ServiceScheduleMonitorLease,
  "key" | "holderInstanceId" | "generation"
>;

export function setServiceScheduleCommandRunnerForTests(runner: ScheduleCommandRunner): void {
  scheduleCommandRunner = runner;
}

export function resetServiceScheduleCommandRunnerForTests(): void {
  scheduleCommandRunner = runServiceCommand;
}

export async function completeServiceScheduleRun(input: {
  runId: string;
  status: "succeeded" | "failed";
  logs: string;
  result?: Record<string, unknown>;
  error?: string | null;
}) {
  const [row] = await db
    .select({ run: serviceScheduleRuns, schedule: serviceSchedules })
    .from(serviceScheduleRuns)
    .innerJoin(serviceSchedules, eq(serviceSchedules.id, serviceScheduleRuns.scheduleId))
    .where(eq(serviceScheduleRuns.id, input.runId))
    .limit(1);
  if (!row) return null;

  const now = new Date();
  const completionConditions = [
    eq(serviceScheduleRuns.id, input.runId),
    inArray(serviceScheduleRuns.status, ["queued", "running"])
  ];
  if (row.run.triggerKind === "scheduled") {
    if (row.run.leaseGeneration === null || row.run.leaseHolderInstanceId === null) {
      return null;
    }
    completionConditions.push(
      eq(serviceScheduleRuns.leaseGeneration, row.run.leaseGeneration),
      eq(serviceScheduleRuns.leaseHolderInstanceId, row.run.leaseHolderInstanceId),
      sql`
        EXISTS (
          SELECT 1
          FROM service_schedule_monitor_leases
          WHERE lease_key = ${SERVICE_SCHEDULE_MONITOR_LEASE_KEY}
            AND holder_instance_id = ${row.run.leaseHolderInstanceId}
            AND generation = ${row.run.leaseGeneration}
            AND expires_at > clock_timestamp()
        )
      `
    );
  }
  const [run] = await db
    .update(serviceScheduleRuns)
    .set({
      status: input.status,
      logs: input.logs,
      result: input.result ?? {},
      error: input.error ?? null,
      startedAt: row.run.startedAt ?? now,
      finishedAt: now,
      updatedAt: now
    })
    .where(and(...completionConditions))
    .returning();
  if (!run) return null;

  await db
    .update(serviceSchedules)
    .set(
      row.run.triggerKind === "manual"
        ? {
            lastRunAt: now,
            updatedAt: now
          }
        : { lastRunAt: now, updatedAt: now }
    )
    .where(eq(serviceSchedules.id, row.schedule.id));

  if (input.status === "failed" && row.schedule.notifyOnFailure) {
    await dispatchScheduleFailureNotification(run.id);
  }

  await pruneServiceScheduleRuns(row.schedule.id, row.schedule.retentionCount);

  return serializeServiceScheduleRun(run);
}

export async function pollServiceScheduleRuns(
  input: {
    limit?: number;
    concurrency?: number;
    lease?: ServiceScheduleRunnerLease;
    signal?: AbortSignal;
  } = {}
) {
  if (
    input.signal?.aborted ||
    (input.lease && !(await isCurrentServiceScheduleMonitorLease(input.lease)))
  ) {
    return { processed: 0, leaseLost: true };
  }

  const rows = await db
    .select({ run: serviceScheduleRuns })
    .from(serviceScheduleRuns)
    .where(
      and(
        eq(serviceScheduleRuns.status, "queued"),
        eq(serviceScheduleRuns.triggerKind, "scheduled")
      )
    )
    .orderBy(asc(serviceScheduleRuns.createdAt))
    .limit(input.limit ?? 10);

  const results = await processWithConcurrency(
    rows.map((row) => row.run.id),
    Math.max(1, Math.min(input.concurrency ?? defaultRunConcurrency, rows.length || 1)),
    (runId) =>
      executeServiceScheduleRun(runId, {
        lease: input.lease,
        signal: input.signal,
        triggerKind: "scheduled"
      })
  );

  return {
    processed: results.filter(Boolean).length,
    leaseLost: Boolean(
      input.signal?.aborted ||
      (input.lease && !(await isCurrentServiceScheduleMonitorLease(input.lease)))
    )
  };
}

export async function executeServiceScheduleRun(
  runId: string,
  input: {
    lease?: ServiceScheduleRunnerLease;
    signal?: AbortSignal;
    triggerKind: "manual" | "scheduled";
  }
) {
  if (input.signal?.aborted) return null;
  const claimConditions = [
    eq(serviceScheduleRuns.id, runId),
    eq(serviceScheduleRuns.status, "queued"),
    eq(serviceScheduleRuns.triggerKind, input.triggerKind)
  ];
  if (input.lease) {
    claimConditions.push(sql`
      EXISTS (
        SELECT 1
        FROM service_schedule_monitor_leases
        WHERE lease_key = ${input.lease.key}
          AND holder_instance_id = ${input.lease.holderInstanceId}
          AND generation = ${input.lease.generation}
          AND expires_at > clock_timestamp()
      )
    `);
  }
  const [claimed] = await db
    .update(serviceScheduleRuns)
    .set({
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
      ...(input.lease
        ? {
            leaseGeneration: input.lease.generation,
            leaseHolderInstanceId: input.lease.holderInstanceId,
            runnerInstanceId: input.lease.holderInstanceId
          }
        : {})
    })
    .where(and(...claimConditions))
    .returning();
  if (!claimed) return null;

  const [context] = await db
    .select({ schedule: serviceSchedules, teamId: projects.teamId })
    .from(serviceScheduleRuns)
    .innerJoin(serviceSchedules, eq(serviceSchedules.id, serviceScheduleRuns.scheduleId))
    .innerJoin(projects, eq(projects.id, serviceSchedules.projectId))
    .where(eq(serviceScheduleRuns.id, runId))
    .limit(1);
  if (!context) {
    return completeServiceScheduleRun({
      runId,
      status: "failed",
      logs: "Service schedule runner accepted the run.\nSchedule context could not be resolved.",
      error: "Schedule context could not be resolved."
    });
  }

  const runtimeResult = await resolveServiceRuntime(context.schedule.serviceId, {
    teamId: context.teamId,
    action: "service_schedule.run_scheduled",
    permissionScope: "service:update"
  });
  if (runtimeResult.status !== "ok") {
    return completeServiceScheduleRun({
      runId,
      status: "failed",
      logs: [
        "Service schedule runner accepted the run.",
        `Command handoff: ${claimed.command}`,
        runtimeResult.message
      ].join("\n"),
      error: runtimeResult.message
    });
  }

  let commandResult: ServiceCommandResult;
  try {
    commandResult = await scheduleCommandRunner({
      runtime: runtimeResult.runtime,
      command: claimed.command,
      signal: input.signal
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return completeServiceScheduleRun({
      runId,
      status: "failed",
      logs: [
        "Service schedule runner accepted the run.",
        `Command handoff: ${claimed.command}`,
        message
      ].join("\n"),
      error: message
    });
  }

  const cancelled = Boolean(commandResult.cancelled);
  const succeeded = commandResult.exitCode === 0 && !cancelled;
  return completeServiceScheduleRun({
    runId,
    status: succeeded ? "succeeded" : "failed",
    logs: [
      "Service schedule runner accepted the run.",
      `Command handoff: ${claimed.command}`,
      commandResult.logs,
      `Runner boundary completed with exit code ${commandResult.exitCode}.`
    ].join("\n"),
    result: {
      handoff: "service-schedule-runner",
      command: claimed.command,
      runtimeKind: runtimeResult.runtime.kind,
      exitCode: commandResult.exitCode,
      timedOut: commandResult.timedOut,
      cancelled
    },
    error: succeeded
      ? null
      : cancelled
        ? "Schedule command was cancelled after monitor lease loss."
        : `Schedule command exited with code ${commandResult.exitCode}.`
  });
}

async function dispatchScheduleFailureNotification(runId: string) {
  const [row] = await db
    .select({
      run: serviceScheduleRuns,
      schedule: serviceSchedules,
      serviceName: services.name,
      projectName: projects.name,
      teamId: projects.teamId,
      environmentName: environments.name
    })
    .from(serviceScheduleRuns)
    .innerJoin(serviceSchedules, eq(serviceSchedules.id, serviceScheduleRuns.scheduleId))
    .innerJoin(services, eq(services.id, serviceSchedules.serviceId))
    .innerJoin(projects, eq(projects.id, serviceSchedules.projectId))
    .innerJoin(environments, eq(environments.id, serviceSchedules.environmentId))
    .where(eq(serviceScheduleRuns.id, runId))
    .limit(1);
  if (!row) return;

  await dispatchNotification({
    eventType: "schedule.failed",
    teamId: row.teamId,
    title: "Scheduled task failed",
    message: `${row.schedule.name} failed for ${row.serviceName}.`,
    severity: "error",
    projectName: row.projectName,
    environmentName: row.environmentName,
    serviceName: row.serviceName,
    fields: [
      { name: "Schedule", value: row.schedule.name, inline: true },
      { name: "Run", value: row.run.id, inline: true },
      { name: "Error", value: row.run.error ?? "Unknown failure", inline: false }
    ],
    timestamp: new Date().toISOString()
  });
}

async function processWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<TResult>
) {
  let cursor = 0;
  const results: TResult[] = [];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) results.push(await worker(item));
    }
  });
  await Promise.all(workers);
  return results;
}
