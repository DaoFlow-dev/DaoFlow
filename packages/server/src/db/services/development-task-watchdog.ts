import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import {
  developmentTaskEvents,
  developmentTaskRuns,
  developmentTasks
} from "../schema/development-tasks";
import { asRecord, newId, readNumber } from "./json-helpers";

const ACTIVE_DEVELOPMENT_TASK_RUN_STATUSES = [
  "claimed",
  "preparing",
  "coding",
  "validating",
  "opening_pr",
  "deploying_preview"
] as const;

const DEFAULT_DEVELOPMENT_TASK_WATCHDOG_TIMEOUT_MS = 65 * 60_000;
const MIN_DEVELOPMENT_TASK_WATCHDOG_TIMEOUT_MS = 5 * 60_000;
const DEVELOPMENT_TASK_WATCHDOG_GRACE_MS = 5 * 60_000;

export interface DevelopmentTaskWatchdogFailure {
  taskId: string;
  runId: string;
  previousStatus: string;
  lastHeartbeatAt: string;
  detectedAt: string;
  staleForMs: number;
  timeoutMs: number;
}

export interface DevelopmentTaskWatchdogRunResult {
  failedCount: number;
  failures: DevelopmentTaskWatchdogFailure[];
}

function resolveRunTimeoutMs(run: typeof developmentTaskRuns.$inferSelect): number {
  const metadata = asRecord(run.metadata);
  const timeoutMinutes = readNumber(metadata, "timeoutMinutes");
  if (!timeoutMinutes || !Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    return DEFAULT_DEVELOPMENT_TASK_WATCHDOG_TIMEOUT_MS;
  }

  return Math.max(
    Math.floor(timeoutMinutes * 60_000) + DEVELOPMENT_TASK_WATCHDOG_GRACE_MS,
    MIN_DEVELOPMENT_TASK_WATCHDOG_TIMEOUT_MS
  );
}

async function loadWatchdogCandidates(input: { now: Date; limit?: number }) {
  const oldestCandidate = new Date(input.now.getTime() - MIN_DEVELOPMENT_TASK_WATCHDOG_TIMEOUT_MS);

  const rows = await db
    .select({
      task: developmentTasks,
      run: developmentTaskRuns
    })
    .from(developmentTaskRuns)
    .innerJoin(
      developmentTasks,
      and(
        eq(developmentTasks.id, developmentTaskRuns.taskId),
        eq(developmentTasks.currentRunId, developmentTaskRuns.id),
        eq(developmentTasks.status, "running")
      )
    )
    .where(
      and(
        inArray(developmentTaskRuns.status, [...ACTIVE_DEVELOPMENT_TASK_RUN_STATUSES]),
        lt(developmentTaskRuns.updatedAt, oldestCandidate)
      )
    )
    .orderBy(asc(developmentTaskRuns.updatedAt))
    .limit(input.limit ?? 8);

  return rows.filter(({ run }) => {
    const timeoutMs = resolveRunTimeoutMs(run);
    return input.now.getTime() - run.updatedAt.getTime() >= timeoutMs;
  });
}

async function markDevelopmentTaskRunFailedByWatchdog(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  now: Date;
}): Promise<DevelopmentTaskWatchdogFailure | null> {
  const timeoutMs = resolveRunTimeoutMs(input.run);
  const staleForMs = input.now.getTime() - input.run.updatedAt.getTime();
  const detectedAt = input.now.toISOString();
  const lastHeartbeatAt = input.run.updatedAt.toISOString();
  const previousStatus = input.run.status;
  const metadata = {
    ...asRecord(input.run.metadata),
    watchdog: {
      detectedAt,
      previousStatus,
      lastHeartbeatAt,
      staleForMs,
      timeoutMs
    }
  };
  const failureMessage = `Development task run ${input.run.id} stopped reporting progress while ${previousStatus}.`;

  return db.transaction(async (tx) => {
    const [updatedRun] = await tx
      .update(developmentTaskRuns)
      .set({
        status: "failed",
        failureCategory: "development_task_watchdog_timeout",
        failureMessage,
        metadata,
        finishedAt: input.now,
        updatedAt: input.now
      })
      .where(
        and(
          eq(developmentTaskRuns.id, input.run.id),
          inArray(developmentTaskRuns.status, [...ACTIVE_DEVELOPMENT_TASK_RUN_STATUSES])
        )
      )
      .returning({ id: developmentTaskRuns.id });

    if (!updatedRun) {
      return null;
    }

    await tx
      .update(developmentTasks)
      .set({
        status: "failed",
        updatedAt: input.now
      })
      .where(
        and(
          eq(developmentTasks.id, input.task.id),
          eq(developmentTasks.currentRunId, input.run.id),
          eq(developmentTasks.status, "running")
        )
      );

    await tx.insert(developmentTaskEvents).values({
      id: newId(),
      taskId: input.task.id,
      runId: input.run.id,
      kind: "run.watchdog_failed",
      summary: "Development task run failed after progress stalled.",
      detail: failureMessage,
      metadata: {
        previousStatus,
        lastHeartbeatAt,
        staleForMs,
        timeoutMs
      },
      createdAt: input.now
    });

    await tx.insert(auditEntries).values({
      actorType: "system",
      actorId: "development-task-watchdog",
      actorEmail: "system@daoflow.local",
      actorRole: "agent",
      targetResource: `development_task/${input.task.id}`,
      action: "development_task.watchdog.fail",
      inputSummary: `Marked development task ${input.task.id} failed after progress stalled.`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: {
        resourceType: "development_task",
        resourceId: input.task.id,
        runId: input.run.id,
        previousStatus,
        lastHeartbeatAt,
        staleForMs,
        timeoutMs
      }
    });

    return {
      taskId: input.task.id,
      runId: input.run.id,
      previousStatus,
      lastHeartbeatAt,
      detectedAt,
      staleForMs,
      timeoutMs
    };
  });
}

export async function runDevelopmentTaskWatchdogOnce(input?: {
  now?: Date;
  limit?: number;
}): Promise<DevelopmentTaskWatchdogRunResult> {
  const now = input?.now ?? new Date();
  const candidates = await loadWatchdogCandidates({ now, limit: input?.limit });
  const failures: DevelopmentTaskWatchdogFailure[] = [];

  for (const candidate of candidates) {
    const failure = await markDevelopmentTaskRunFailedByWatchdog({
      task: candidate.task,
      run: candidate.run,
      now
    });
    if (failure) {
      failures.push(failure);
    }
  }

  return {
    failedCount: failures.length,
    failures
  };
}
