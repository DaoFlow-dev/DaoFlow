import { and, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import {
  developmentTaskEvents,
  developmentTaskRuns,
  developmentTasks
} from "../schema/development-tasks";
import { newId } from "./json-helpers";

export interface DevelopmentTaskClaimActor {
  runnerId: string;
  runnerLabel: string;
}

export async function claimNextQueuedDevelopmentTask(actor: DevelopmentTaskClaimActor) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [task] = await tx
      .update(developmentTasks)
      .set({
        status: "running",
        updatedAt: now
      })
      .where(
        and(
          eq(developmentTasks.status, "queued"),
          eq(
            developmentTasks.id,
            sql`
              (
                SELECT candidate.id
                FROM ${developmentTasks} AS candidate
                WHERE candidate.status = 'queued'
                ORDER BY candidate.priority ASC, candidate.created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
              )
            `
          )
        )
      )
      .returning();

    if (!task) {
      return null;
    }

    const runId = newId();
    const [run] = await tx
      .insert(developmentTaskRuns)
      .values({
        id: runId,
        taskId: task.id,
        status: "claimed",
        runnerId: actor.runnerId,
        metadata: {
          runnerLabel: actor.runnerLabel
        },
        startedAt: now,
        updatedAt: now
      })
      .returning();

    await tx
      .update(developmentTasks)
      .set({
        currentRunId: run.id,
        updatedAt: now
      })
      .where(eq(developmentTasks.id, task.id));

    await tx.insert(developmentTaskEvents).values({
      id: newId(),
      taskId: task.id,
      runId: run.id,
      kind: "run.claimed",
      summary: `${actor.runnerLabel} claimed the development task.`,
      metadata: {
        runnerId: actor.runnerId
      }
    });

    await tx.insert(auditEntries).values({
      actorType: "system",
      actorId: actor.runnerId,
      actorEmail: "system@daoflow.local",
      actorRole: "agent",
      targetResource: `development_task/${task.id}`,
      action: "development_task.claim",
      inputSummary: `${actor.runnerLabel} claimed development task ${task.id}`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: {
        resourceType: "development_task",
        resourceId: task.id,
        runId: run.id,
        runnerId: actor.runnerId
      }
    });

    return { task: { ...task, status: "running", currentRunId: run.id }, run };
  });
}
