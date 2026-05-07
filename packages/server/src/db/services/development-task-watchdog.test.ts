import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import {
  developmentTaskEvents,
  developmentTaskRuns,
  developmentTasks
} from "../schema/development-tasks";
import { resetSeededTestDatabase } from "../../test-db";
import {
  createDevelopmentTaskRun,
  queueDevelopmentTask,
  updateDevelopmentTaskRun
} from "./development-tasks";
import { runDevelopmentTaskWatchdogOnce } from "./development-task-watchdog";
import { asRecord } from "./json-helpers";

let watchdogTaskCounter = 0;

function taskInput(label: string) {
  watchdogTaskCounter += 1;
  const suffix = `${label}-${Date.now()}-${watchdogTaskCounter}`;
  return {
    providerType: "github" as const,
    projectId: "proj_daoflow_control_plane",
    repoFullName: "DaoFlow-dev/DaoFlow",
    externalIssueId: `watchdog-${suffix}`,
    issueNumber: 185,
    issueUrl: `https://github.com/DaoFlow-dev/DaoFlow/issues/${watchdogTaskCounter}`,
    issueTitle: `Watchdog ${label}`,
    issueAuthor: "octocat",
    requestedByExternalUser: "octocat"
  };
}

async function queueRunningTask(label: string, timeoutMinutes = 60) {
  const queued = await queueDevelopmentTask(taskInput(label));
  expect(queued.status).toBe("created");
  if (queued.status !== "created") {
    throw new Error("Expected development task fixture to be created.");
  }

  const run = await createDevelopmentTaskRun({
    taskId: queued.task.id,
    metadata: { timeoutMinutes }
  });
  const updated = await updateDevelopmentTaskRun({
    runId: run.id,
    status: "coding",
    metadata: { timeoutMinutes }
  });
  expect(updated?.status).toBe("coding");

  return { task: queued.task, run };
}

describe("development task watchdog", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
  });

  it("marks stale active development task runs failed with event and audit evidence", async () => {
    const now = new Date("2026-05-07T20:00:00.000Z");
    const { task, run } = await queueRunningTask("stale", 10);

    await db
      .update(developmentTaskRuns)
      .set({ updatedAt: new Date(now.getTime() - 20 * 60_000) })
      .where(eq(developmentTaskRuns.id, run.id));

    const result = await runDevelopmentTaskWatchdogOnce({ now });

    expect(result.failedCount).toBe(1);
    expect(result.failures[0]).toMatchObject({
      taskId: task.id,
      runId: run.id,
      previousStatus: "coding",
      timeoutMs: 15 * 60_000
    });

    const [updatedRun] = await db
      .select()
      .from(developmentTaskRuns)
      .where(eq(developmentTaskRuns.id, run.id));
    expect(updatedRun).toMatchObject({
      status: "failed",
      failureCategory: "development_task_watchdog_timeout"
    });
    expect(asRecord(asRecord(updatedRun?.metadata).watchdog).previousStatus).toBe("coding");

    const [updatedTask] = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.id, task.id));
    expect(updatedTask?.status).toBe("failed");

    const eventRows = await db
      .select()
      .from(developmentTaskEvents)
      .where(eq(developmentTaskEvents.runId, run.id));
    expect(eventRows.some((event) => event.kind === "run.watchdog_failed")).toBe(true);

    const auditRows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `development_task/${task.id}`));
    expect(auditRows.some((entry) => entry.action === "development_task.watchdog.fail")).toBe(true);
  });

  it("ignores fresh active runs and tasks waiting for human review", async () => {
    const now = new Date("2026-05-07T20:00:00.000Z");
    const fresh = await queueRunningTask("fresh", 10);
    const waiting = await queueRunningTask("waiting", 10);

    await updateDevelopmentTaskRun({
      runId: waiting.run.id,
      status: "waiting_review",
      metadata: { timeoutMinutes: 10 }
    });
    await db
      .update(developmentTaskRuns)
      .set({ updatedAt: new Date(now.getTime() - 60 * 60_000) })
      .where(eq(developmentTaskRuns.id, waiting.run.id));

    const result = await runDevelopmentTaskWatchdogOnce({ now });

    expect(result.failedCount).toBe(0);
    const rows = await db
      .select()
      .from(developmentTaskRuns)
      .where(eq(developmentTaskRuns.taskId, fresh.task.id));
    expect(rows[0]?.status).toBe("coding");

    const waitingRows = await db
      .select()
      .from(developmentTaskRuns)
      .where(eq(developmentTaskRuns.taskId, waiting.task.id));
    expect(waitingRows[0]?.status).toBe("waiting_review");
  });
});
