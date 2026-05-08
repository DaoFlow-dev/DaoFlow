import { db } from "../connection";
import { developmentTaskComments, developmentTaskEvents } from "../schema/development-tasks";
import { newId } from "./json-helpers";
import type {
  RecordDevelopmentTaskCommentInput,
  RecordDevelopmentTaskEventInput
} from "./development-task-types";

export function normalizeDevelopmentTaskMetadata(value: Record<string, unknown> | undefined) {
  return value ?? {};
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
      metadata: normalizeDevelopmentTaskMetadata(input.metadata)
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
      metadata: normalizeDevelopmentTaskMetadata(input.metadata),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [developmentTaskComments.providerType, developmentTaskComments.externalCommentId],
      set: {
        taskId: input.taskId,
        runId: input.runId ?? null,
        commentKind: input.commentKind,
        lastBodyHash: input.lastBodyHash ?? null,
        metadata: normalizeDevelopmentTaskMetadata(input.metadata),
        updatedAt: now
      }
    })
    .returning();

  return comment;
}
