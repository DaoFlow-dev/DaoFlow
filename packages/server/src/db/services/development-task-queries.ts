import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import {
  developmentTaskComments,
  developmentTaskEvents,
  developmentTaskRuns,
  developmentTasks
} from "../schema/development-tasks";
import { projects } from "../schema/projects";
import { asRecord } from "./json-helpers";
import { ACTIVE_TASK_STATUSES, type DevelopmentTaskStatus } from "./development-task-types";

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
