import { eq } from "drizzle-orm";
import { db } from "../connection";
import { developmentTaskRuns, developmentTasks } from "../schema/development-tasks";
import { newId } from "./json-helpers";
import {
  normalizeDevelopmentTaskMetadata,
  recordDevelopmentTaskEvent
} from "./development-task-records";
import type {
  CreateDevelopmentTaskRunInput,
  DevelopmentTaskRunStatus,
  DevelopmentTaskStatus,
  UpdateDevelopmentTaskRunInput
} from "./development-task-types";

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
      metadata: normalizeDevelopmentTaskMetadata(input.metadata)
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
