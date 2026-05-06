import { and, eq, inArray } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import {
  developmentTaskEvents,
  developmentTaskRuns,
  developmentTasks
} from "../schema/development-tasks";
import { projects } from "../schema/projects";
import { asRecord, newId } from "./json-helpers";
import type { DevelopmentTaskStatus } from "./development-tasks";

const CANCELABLE_STATUSES: DevelopmentTaskStatus[] = [
  "queued",
  "running",
  "waiting_review",
  "blocked"
];
const RETRYABLE_STATUSES: DevelopmentTaskStatus[] = ["failed", "canceled", "blocked"];
const OPEN_RUN_STATUSES = [
  "queued",
  "claimed",
  "preparing",
  "coding",
  "validating",
  "opening_pr",
  "deploying_preview",
  "waiting_review"
];

interface DevelopmentTaskLifecycleActor {
  userId: string;
  email: string;
  role: AppRole;
}

interface DevelopmentTaskLifecycleInput extends DevelopmentTaskLifecycleActor {
  taskId: string;
  teamId?: string;
}

async function findScopedTask(taskId: string, teamId?: string) {
  const filters = [eq(developmentTasks.id, taskId)];
  if (teamId) {
    filters.push(eq(projects.teamId, teamId));
  }

  const [row] = await db
    .select({ task: developmentTasks })
    .from(developmentTasks)
    .innerJoin(projects, eq(projects.id, developmentTasks.projectId))
    .where(and(...filters))
    .limit(1);

  return row?.task ?? null;
}

function auditActor(input: DevelopmentTaskLifecycleActor) {
  return {
    actorType: "user",
    actorId: input.userId,
    actorEmail: input.email,
    actorRole: input.role
  };
}

export async function cancelDevelopmentTask(input: DevelopmentTaskLifecycleInput) {
  const task = await findScopedTask(input.taskId, input.teamId);
  if (!task) {
    return { status: "not-found" as const };
  }

  const previousStatus = task.status as DevelopmentTaskStatus;
  if (!CANCELABLE_STATUSES.includes(previousStatus)) {
    return { status: "invalid-state" as const, currentStatus: previousStatus };
  }

  const now = new Date();
  const [updated] = await db
    .update(developmentTasks)
    .set({ status: "canceled", updatedAt: now })
    .where(eq(developmentTasks.id, task.id))
    .returning();

  if (task.currentRunId) {
    await db
      .update(developmentTaskRuns)
      .set({
        status: "canceled",
        failureCategory: "user_canceled",
        failureMessage: `Canceled by ${input.email}.`,
        finishedAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(developmentTaskRuns.id, task.currentRunId),
          inArray(developmentTaskRuns.status, OPEN_RUN_STATUSES)
        )
      );
  }

  await Promise.all([
    db.insert(developmentTaskEvents).values({
      id: newId(),
      taskId: task.id,
      runId: task.currentRunId,
      kind: "task.canceled",
      summary: `Development task canceled by ${input.email}.`,
      metadata: { previousStatus, canceledBy: input.email }
    }),
    db.insert(auditEntries).values({
      ...auditActor(input),
      targetResource: `development_task/${task.id}`,
      action: "development_task.cancel",
      inputSummary: `Canceled development task ${task.repoFullName}#${task.issueNumber}`,
      permissionScope: "deploy:cancel",
      outcome: "success",
      metadata: {
        resourceType: "development_task",
        resourceId: task.id,
        runId: task.currentRunId,
        previousStatus
      }
    })
  ]);

  return { status: "canceled" as const, task: updated };
}

export async function retryDevelopmentTask(input: DevelopmentTaskLifecycleInput) {
  const task = await findScopedTask(input.taskId, input.teamId);
  if (!task) {
    return { status: "not-found" as const };
  }

  const previousStatus = task.status as DevelopmentTaskStatus;
  if (!RETRYABLE_STATUSES.includes(previousStatus)) {
    return { status: "invalid-state" as const, currentStatus: previousStatus };
  }

  const now = new Date();
  const previousRunId = task.currentRunId;
  const [updated] = await db
    .update(developmentTasks)
    .set({
      status: "queued",
      currentRunId: null,
      metadata: {
        ...asRecord(task.metadata),
        retry: {
          requestedAt: now.toISOString(),
          requestedBy: input.email,
          previousStatus,
          previousRunId
        }
      },
      updatedAt: now
    })
    .where(eq(developmentTasks.id, task.id))
    .returning();

  await Promise.all([
    db.insert(developmentTaskEvents).values({
      id: newId(),
      taskId: task.id,
      runId: previousRunId,
      kind: "task.retry_queued",
      summary: `Development task retry queued by ${input.email}.`,
      metadata: { previousStatus, previousRunId, requestedBy: input.email }
    }),
    db.insert(auditEntries).values({
      ...auditActor(input),
      targetResource: `development_task/${task.id}`,
      action: "development_task.retry",
      inputSummary: `Retried development task ${task.repoFullName}#${task.issueNumber}`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: {
        resourceType: "development_task",
        resourceId: task.id,
        previousRunId,
        previousStatus
      }
    })
  ]);

  return { status: "queued" as const, task: updated };
}
