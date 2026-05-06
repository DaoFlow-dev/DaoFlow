import { describe, expect, it } from "vitest";
import {
  createDevelopmentTaskRun,
  getDevelopmentTaskDetails,
  queueDevelopmentTask
} from "../db/services/development-tasks";
import { createProject } from "../db/services/projects";
import { resetSeededTestDatabase } from "../test-db";
import { createDevelopmentTaskLogEventStream } from "./development-task-log-events";

async function createLogEventFixture() {
  await resetSeededTestDatabase();
  const projectResult = await createProject({
    name: `Development Task Logs ${Date.now()}`,
    repoUrl: "https://github.com/example/development-task-logs",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create project.");
  }

  const queued = await queueDevelopmentTask({
    providerType: "github",
    projectId: projectResult.project.id,
    repoFullName: "example/development-task-logs",
    externalIssueId: "log-event-issue",
    issueNumber: 185,
    issueUrl: "https://github.com/example/development-task-logs/issues/185",
    issueTitle: "Stream task logs",
    requestedByExternalUser: "octocat"
  });
  expect(queued.status).toBe("created");
  if (queued.status !== "created") {
    throw new Error("Expected development task to be created.");
  }

  const run = await createDevelopmentTaskRun({ taskId: queued.task.id });
  return { task: queued.task, run };
}

describe("development task log events", () => {
  it("records bounded log lines and a truncation event", async () => {
    const fixture = await createLogEventFixture();
    const stream = createDevelopmentTaskLogEventStream({
      taskId: fixture.task.id,
      runId: fixture.run.id,
      phase: "codex",
      maxEvents: 1
    });

    stream.record({ stream: "stdout", message: "first line", timestamp: new Date(0) });
    stream.record({ stream: "stderr", message: "second line", timestamp: new Date(1) });
    await stream.flush();

    const details = await getDevelopmentTaskDetails(fixture.task.id);
    const events = details?.events ?? [];
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["codex.log", "codex.log.truncated"])
    );
    expect(events.find((event) => event.kind === "codex.log")).toMatchObject({
      summary: "codex stdout: first line",
      detail: "first line"
    });
    expect(events.find((event) => event.kind === "codex.log.truncated")?.metadata).toMatchObject({
      dropped: 1,
      maxEvents: 1
    });
  });
});
