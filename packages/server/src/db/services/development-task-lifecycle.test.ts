import { describe, expect, it, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { developmentTaskRuns } from "../schema/development-tasks";
import { resetSeededTestDatabase } from "../../test-db";
import { cancelDevelopmentTask, retryDevelopmentTask } from "./development-task-lifecycle";
import {
  createDevelopmentTaskRun,
  getDevelopmentTaskDetails,
  queueDevelopmentTask,
  updateDevelopmentTaskRun
} from "./development-tasks";

const PROJECT_ID = "proj_daoflow_control_plane";
const ACTOR = {
  userId: "user_foundation_owner",
  email: "owner@daoflow.local",
  role: "owner" as const
};

function taskInput() {
  return {
    providerType: "github" as const,
    projectId: PROJECT_ID,
    repoFullName: "DaoFlow-dev/DaoFlow",
    externalIssueId: `185-lifecycle-${Date.now()}`,
    issueNumber: 185,
    issueUrl: "https://github.com/DaoFlow-dev/DaoFlow/issues/185",
    issueTitle: "Major: Agent swarm dev platform",
    issueAuthor: "MikeChongCan",
    requestedByExternalUser: "MikeChongCan"
  };
}

describe("development task lifecycle", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
  });

  it("cancels an active task and records audit evidence", async () => {
    const queued = await queueDevelopmentTask(taskInput());
    const run = await createDevelopmentTaskRun({ taskId: queued.task.id });
    await updateDevelopmentTaskRun({ runId: run.id, status: "claimed" });

    const result = await cancelDevelopmentTask({
      taskId: queued.task.id,
      ...ACTOR
    });

    expect(result.status).toBe("canceled");
    const details = await getDevelopmentTaskDetails(queued.task.id);
    expect(details?.task.status).toBe("canceled");
    expect(details?.events.some((event) => event.kind === "task.canceled")).toBe(true);

    const [updatedRun] = await db
      .select()
      .from(developmentTaskRuns)
      .where(eq(developmentTaskRuns.id, run.id));
    expect(updatedRun?.status).toBe("canceled");

    const [auditEntry] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.targetResource, `development_task/${queued.task.id}`),
          eq(auditEntries.action, "development_task.cancel")
        )
      );
    expect(auditEntry?.metadata).toMatchObject({
      resourceId: queued.task.id,
      runId: run.id,
      previousStatus: "running"
    });
  });

  it("retries a failed task and records audit evidence", async () => {
    const queued = await queueDevelopmentTask(taskInput());
    const run = await createDevelopmentTaskRun({ taskId: queued.task.id });
    await updateDevelopmentTaskRun({
      runId: run.id,
      status: "failed",
      failureCategory: "validation_failed",
      failureMessage: "Tests failed."
    });

    const result = await retryDevelopmentTask({
      taskId: queued.task.id,
      ...ACTOR
    });

    expect(result.status).toBe("queued");
    const details = await getDevelopmentTaskDetails(queued.task.id);
    expect(details?.task.status).toBe("queued");
    expect(details?.task.currentRunId).toBeNull();
    expect(details?.task.metadata).toMatchObject({
      retry: {
        requestedBy: ACTOR.email,
        previousStatus: "failed",
        previousRunId: run.id
      }
    });
    expect(details?.events.some((event) => event.kind === "task.retry_queued")).toBe(true);

    const [auditEntry] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.targetResource, `development_task/${queued.task.id}`),
          eq(auditEntries.action, "development_task.retry")
        )
      );
    expect(auditEntry?.metadata).toMatchObject({
      resourceId: queued.task.id,
      previousRunId: run.id,
      previousStatus: "failed"
    });
  });
});
