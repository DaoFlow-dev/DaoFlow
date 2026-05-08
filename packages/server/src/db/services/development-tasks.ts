import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import {
  DEVELOPMENT_TASK_RUN_STATUSES,
  DEVELOPMENT_TASK_STATUSES,
  developmentTaskComments,
  developmentTaskEvents,
  developmentTaskRuns,
  developmentTasks
} from "../schema/development-tasks";
import { projects } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";
import { asRecord, newId } from "./json-helpers";

export { listSandboxRunnerProfiles } from "./development-task-runner-profiles";

export type DevelopmentTaskStatus = (typeof DEVELOPMENT_TASK_STATUSES)[number];
export type DevelopmentTaskRunStatus = (typeof DEVELOPMENT_TASK_RUN_STATUSES)[number];
export type DevelopmentTaskProviderType = "github" | "gitlab";

const ACTIVE_TASK_STATUSES: DevelopmentTaskStatus[] = [
  "queued",
  "running",
  "waiting_review",
  "blocked"
];

export interface DevelopmentTaskActor {
  requestedByUserId?: string | null;
  requestedByEmail?: string | null;
  requestedByRole?: AppRole | "agent" | null;
  requestedByExternalUser?: string | null;
}

export interface QueueDevelopmentTaskInput extends DevelopmentTaskActor {
  providerType: DevelopmentTaskProviderType;
  providerInstallationId?: string | null;
  projectId: string;
  repoFullName: string;
  externalIssueId: string;
  issueNumber: number;
  issueUrl: string;
  issueTitle: string;
  issueAuthor?: string | null;
  baseBranch?: string | null;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateDevelopmentTaskRunInput {
  taskId: string;
  runnerProfileId?: string | null;
  sandboxProvider?: string | null;
  codexProfile?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordDevelopmentTaskEventInput {
  taskId: string;
  runId?: string | null;
  kind: string;
  summary: string;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordDevelopmentTaskCommentInput {
  taskId: string;
  runId?: string | null;
  providerType: DevelopmentTaskProviderType;
  externalCommentId: string;
  commentKind: string;
  lastBodyHash?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateDevelopmentTaskRunInput {
  runId: string;
  status: DevelopmentTaskRunStatus;
  runnerId?: string | null;
  sandboxId?: string | null;
  branchName?: string | null;
  commitSha?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  previewDeploymentId?: string | null;
  previewUrl?: string | null;
  failureCategory?: string | null;
  failureMessage?: string | null;
  metadata?: Record<string, unknown>;
}

function normalizeMetadata(value: Record<string, unknown> | undefined) {
  return value ?? {};
}

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
      metadata: normalizeMetadata(input.metadata),
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

export async function createDevelopmentTaskRun(input: CreateDevelopmentTaskRunInput) {
  const runId = newId();
  const [run] = await db
    .insert(developmentTaskRuns)
    .values({
      id: runId,
      taskId: input.taskId,
      runnerProfileId: input.runnerProfileId ?? null,
      sandboxProvider: input.sandboxProvider ?? null,
      codexProfile: input.codexProfile ?? null,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      metadata: normalizeMetadata(input.metadata)
    })
    .returning();

  await db
    .update(developmentTasks)
    .set({
      currentRunId: run.id,
      updatedAt: new Date()
    })
    .where(eq(developmentTasks.id, input.taskId));

  await recordDevelopmentTaskEvent({
    taskId: input.taskId,
    runId: run.id,
    kind: "run.queued",
    summary: "Queued a development task run.",
    metadata: {
      runnerProfileId: input.runnerProfileId ?? null,
      sandboxProvider: input.sandboxProvider ?? null
    }
  });

  return run;
}

export async function updateDevelopmentTaskRun(input: UpdateDevelopmentTaskRunInput) {
  const now = new Date();
  const isStarted = ["claimed", "preparing", "coding", "validating"].includes(input.status);
  const isFinished = ["failed", "canceled", "completed", "waiting_review"].includes(input.status);
  const [run] = await db
    .update(developmentTaskRuns)
    .set({
      status: input.status,
      runnerId: input.runnerId ?? undefined,
      sandboxId: input.sandboxId ?? undefined,
      branchName: input.branchName ?? undefined,
      commitSha: input.commitSha ?? undefined,
      pullRequestNumber: input.pullRequestNumber ?? undefined,
      pullRequestUrl: input.pullRequestUrl ?? undefined,
      previewDeploymentId: input.previewDeploymentId ?? undefined,
      previewUrl: input.previewUrl ?? undefined,
      failureCategory: input.failureCategory ?? undefined,
      failureMessage: input.failureMessage ?? undefined,
      metadata: input.metadata ? input.metadata : undefined,
      startedAt: isStarted ? now : undefined,
      finishedAt: isFinished ? now : undefined,
      updatedAt: now
    })
    .where(eq(developmentTaskRuns.id, input.runId))
    .returning();

  if (!run) {
    return null;
  }

  const taskStatus = mapRunStatusToTaskStatus(input.status);
  if (taskStatus) {
    await db
      .update(developmentTasks)
      .set({
        status: taskStatus,
        updatedAt: now
      })
      .where(eq(developmentTasks.id, run.taskId));
  }

  await recordDevelopmentTaskEvent({
    taskId: run.taskId,
    runId: run.id,
    kind: `run.${input.status}`,
    summary: `Development task run moved to ${input.status}.`,
    detail: input.failureMessage ?? null,
    metadata: {
      failureCategory: input.failureCategory ?? null,
      pullRequestUrl: input.pullRequestUrl ?? null,
      previewUrl: input.previewUrl ?? null
    }
  });

  return run;
}

function mapRunStatusToTaskStatus(status: DevelopmentTaskRunStatus): DevelopmentTaskStatus | null {
  if (status === "queued") return "queued";
  if (status === "claimed" || status === "preparing" || status === "coding") return "running";
  if (status === "validating" || status === "opening_pr" || status === "deploying_preview") {
    return "running";
  }
  if (status === "waiting_review") return "waiting_review";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  if (status === "completed") return "completed";
  return null;
}

export async function recordDevelopmentTaskEvent(input: RecordDevelopmentTaskEventInput) {
  const [event] = await db
    .insert(developmentTaskEvents)
    .values({
      id: newId(),
      taskId: input.taskId,
      runId: input.runId ?? null,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail ?? null,
      metadata: normalizeMetadata(input.metadata)
    })
    .returning();

  return event;
}

export async function recordDevelopmentTaskComment(input: RecordDevelopmentTaskCommentInput) {
  const now = new Date();
  const [comment] = await db
    .insert(developmentTaskComments)
    .values({
      id: newId(),
      taskId: input.taskId,
      runId: input.runId ?? null,
      providerType: input.providerType,
      externalCommentId: input.externalCommentId,
      commentKind: input.commentKind,
      lastBodyHash: input.lastBodyHash ?? null,
      metadata: normalizeMetadata(input.metadata),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [developmentTaskComments.providerType, developmentTaskComments.externalCommentId],
      set: {
        taskId: input.taskId,
        runId: input.runId ?? null,
        commentKind: input.commentKind,
        lastBodyHash: input.lastBodyHash ?? null,
        metadata: normalizeMetadata(input.metadata),
        updatedAt: now
      }
    })
    .returning();

  return comment;
}

export async function listDevelopmentTasks(input?: {
  status?: DevelopmentTaskStatus;
  teamId?: string;
  limit?: number;
}) {
  const selectFields = {
    task: developmentTasks
  };
  const query = db
    .select(selectFields)
    .from(developmentTasks)
    .innerJoin(projects, eq(projects.id, developmentTasks.projectId));
  const filters = [
    input?.status ? eq(developmentTasks.status, input.status) : undefined,
    input?.teamId ? eq(projects.teamId, input.teamId) : undefined
  ].filter((filter): filter is Exclude<typeof filter, undefined> => Boolean(filter));

  const rows = input?.status
    ? await query
        .where(and(...filters))
        .orderBy(desc(developmentTasks.createdAt))
        .limit(input.limit ?? 24)
    : filters.length > 0
      ? await query
          .where(and(...filters))
          .orderBy(desc(developmentTasks.createdAt))
          .limit(input?.limit ?? 24)
      : await query.orderBy(desc(developmentTasks.createdAt)).limit(input?.limit ?? 24);

  return rows.map(({ task }) => ({
    ...task,
    isActive: ACTIVE_TASK_STATUSES.includes(task.status as DevelopmentTaskStatus),
    metadata: asRecord(task.metadata)
  }));
}

export async function getDevelopmentTaskDetails(taskId: string, teamId?: string) {
  const [row] = await db
    .select({ task: developmentTasks })
    .from(developmentTasks)
    .innerJoin(projects, eq(projects.id, developmentTasks.projectId))
    .where(
      teamId
        ? and(eq(developmentTasks.id, taskId), eq(projects.teamId, teamId))
        : eq(developmentTasks.id, taskId)
    )
    .limit(1);

  const task = row?.task ?? null;
  if (!task) {
    return null;
  }

  const [runs, events, comments] = await Promise.all([
    db
      .select()
      .from(developmentTaskRuns)
      .where(eq(developmentTaskRuns.taskId, taskId))
      .orderBy(desc(developmentTaskRuns.createdAt)),
    db
      .select()
      .from(developmentTaskEvents)
      .where(eq(developmentTaskEvents.taskId, taskId))
      .orderBy(desc(developmentTaskEvents.createdAt)),
    db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.taskId, taskId))
      .orderBy(desc(developmentTaskComments.createdAt))
  ]);

  return {
    task: {
      ...task,
      isActive: ACTIVE_TASK_STATUSES.includes(task.status as DevelopmentTaskStatus),
      metadata: asRecord(task.metadata)
    },
    runs: runs.map((run) => ({ ...run, metadata: asRecord(run.metadata) })),
    events: events.map((event) => ({ ...event, metadata: asRecord(event.metadata) })),
    comments: comments.map((comment) => ({ ...comment, metadata: asRecord(comment.metadata) }))
  };
}
