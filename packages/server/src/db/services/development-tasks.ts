import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { developmentTasks } from "../schema/development-tasks";
import { newId } from "./json-helpers";
import {
  normalizeDevelopmentTaskMetadata,
  recordDevelopmentTaskEvent
} from "./development-task-records";
import type { DevelopmentTaskActor, QueueDevelopmentTaskInput } from "./development-task-types";

export { listSandboxRunnerProfiles } from "./development-task-runner-profiles";
export { getDevelopmentTaskDetails, listDevelopmentTasks } from "./development-task-queries";
export {
  recordDevelopmentTaskComment,
  recordDevelopmentTaskEvent
} from "./development-task-records";
export { createDevelopmentTaskRun, updateDevelopmentTaskRun } from "./development-task-runs";
export type {
  CreateDevelopmentTaskRunInput,
  DevelopmentTaskActor,
  DevelopmentTaskProviderType,
  DevelopmentTaskRunStatus,
  DevelopmentTaskStatus,
  QueueDevelopmentTaskInput,
  RecordDevelopmentTaskCommentInput,
  RecordDevelopmentTaskEventInput,
  UpdateDevelopmentTaskRunInput
} from "./development-task-types";

function actorEmail(input: DevelopmentTaskActor) {
  return input.requestedByEmail ?? input.requestedByExternalUser ?? "development-task";
}

function actorId(input: DevelopmentTaskActor) {
  return input.requestedByUserId ?? input.requestedByExternalUser ?? "development-task";
}

function actorType(input: DevelopmentTaskActor) {
  return input.requestedByUserId ? "user" : "agent";
}

export async function queueDevelopmentTask(input: QueueDevelopmentTaskInput) {
  const now = new Date();
  const taskId = newId();
  const [created] = await db
    .insert(developmentTasks)
    .values({
      id: taskId,
      providerType: input.providerType,
      providerInstallationId: input.providerInstallationId ?? null,
      projectId: input.projectId,
      repoFullName: input.repoFullName,
      externalIssueId: input.externalIssueId,
      issueNumber: input.issueNumber,
      issueUrl: input.issueUrl,
      issueTitle: input.issueTitle,
      issueAuthor: input.issueAuthor ?? null,
      baseBranch: input.baseBranch ?? "main",
      priority: input.priority ?? 100,
      requestedByExternalUser: input.requestedByExternalUser ?? input.issueAuthor ?? null,
      requestedByPrincipalId: input.requestedByUserId ?? null,
      metadata: normalizeDevelopmentTaskMetadata(input.metadata),
      updatedAt: now
    })
    .onConflictDoNothing({
      target: [
        developmentTasks.providerType,
        developmentTasks.repoFullName,
        developmentTasks.projectId,
        developmentTasks.externalIssueId
      ]
    })
    .returning();

  if (!created) {
    const [existing] = await db
      .select()
      .from(developmentTasks)
      .where(
        and(
          eq(developmentTasks.providerType, input.providerType),
          eq(developmentTasks.repoFullName, input.repoFullName),
          eq(developmentTasks.projectId, input.projectId),
          eq(developmentTasks.externalIssueId, input.externalIssueId)
        )
      )
      .limit(1);

    return {
      status: "duplicate" as const,
      task: existing ?? null
    };
  }

  await Promise.all([
    recordDevelopmentTaskEvent({
      taskId: created.id,
      kind: "queued",
      summary: `Queued development task for ${input.repoFullName}#${input.issueNumber}.`,
      metadata: {
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        externalIssueId: input.externalIssueId
      }
    }),
    db.insert(auditEntries).values({
      actorType: actorType(input),
      actorId: actorId(input),
      actorEmail: actorEmail(input),
      actorRole: input.requestedByRole ?? "agent",
      targetResource: `development_task/${created.id}`,
      action: "development_task.queue",
      inputSummary: `Queued development task for ${input.repoFullName}#${input.issueNumber}`,
      permissionScope: "deploy:read",
      outcome: "success",
      metadata: {
        resourceType: "development_task",
        resourceId: created.id,
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        issueNumber: input.issueNumber
      }
    })
  ]);

  return {
    status: "created" as const,
    task: created
  };
}
