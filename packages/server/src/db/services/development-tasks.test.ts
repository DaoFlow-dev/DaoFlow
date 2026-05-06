import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { sandboxRunnerProfiles } from "../schema/development-tasks";
import { resetSeededTestDatabase } from "../../test-db";
import {
  createDevelopmentTaskRun,
  getDevelopmentTaskDetails,
  listDevelopmentTasks,
  listSandboxRunnerProfiles,
  queueDevelopmentTask,
  recordDevelopmentTaskComment,
  updateDevelopmentTaskRun
} from "./development-tasks";

const PROJECT_ID = "proj_daoflow_control_plane";

function taskInput(overrides?: Partial<Parameters<typeof queueDevelopmentTask>[0]>) {
  return {
    providerType: "github" as const,
    projectId: PROJECT_ID,
    repoFullName: "DaoFlow-dev/DaoFlow",
    externalIssueId: "185",
    issueNumber: 185,
    issueUrl: "https://github.com/DaoFlow-dev/DaoFlow/issues/185",
    issueTitle: "Major: Agent swarm dev platform",
    issueAuthor: "MikeChongCan",
    requestedByExternalUser: "MikeChongCan",
    metadata: {
      trigger: "issue_comment"
    },
    ...overrides
  };
}

describe("development task service", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
  });

  it("queues a development task idempotently by provider, repo, and issue", async () => {
    const first = await queueDevelopmentTask(taskInput());
    const second = await queueDevelopmentTask(
      taskInput({
        issueTitle: "Duplicate delivery should not create a second active task"
      })
    );

    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    expect(second.task?.id).toBe(first.task?.id);

    const tasks = await listDevelopmentTasks({ limit: 10 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      providerType: "github",
      repoFullName: "DaoFlow-dev/DaoFlow",
      issueNumber: 185,
      status: "queued",
      isActive: true
    });
  });

  it("creates a run and mirrors terminal run states onto the parent task", async () => {
    const queued = await queueDevelopmentTask(taskInput());
    const taskId = queued.task.id;
    const run = await createDevelopmentTaskRun({
      taskId,
      sandboxProvider: "host_docker",
      codexProfile: "daoflow-run",
      model: "gpt-5.4"
    });

    await updateDevelopmentTaskRun({
      runId: run.id,
      status: "claimed",
      runnerId: "runner-1",
      sandboxId: "sandbox-1"
    });

    const running = await getDevelopmentTaskDetails(taskId);
    expect(running?.task.status).toBe("running");
    expect(running?.runs[0]).toMatchObject({
      id: run.id,
      status: "claimed",
      runnerId: "runner-1",
      sandboxId: "sandbox-1"
    });

    await updateDevelopmentTaskRun({
      runId: run.id,
      status: "waiting_review",
      branchName: "daoflow/issue-185-run",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/DaoFlow-dev/DaoFlow/pull/42",
      previewUrl: "https://preview.example.test"
    });

    const waitingReview = await getDevelopmentTaskDetails(taskId);
    expect(waitingReview?.task.status).toBe("waiting_review");
    expect(waitingReview?.runs[0]).toMatchObject({
      status: "waiting_review",
      branchName: "daoflow/issue-185-run",
      pullRequestNumber: 42,
      previewUrl: "https://preview.example.test"
    });
    expect(waitingReview?.events.some((event) => event.kind === "run.waiting_review")).toBe(true);
  });

  it("upserts external issue comments for durable status updates", async () => {
    const queued = await queueDevelopmentTask(taskInput());
    const taskId = queued.task.id;
    const created = await recordDevelopmentTaskComment({
      taskId,
      providerType: "github",
      externalCommentId: "comment-1",
      commentKind: "status",
      lastBodyHash: "hash-a"
    });

    const updated = await recordDevelopmentTaskComment({
      taskId,
      providerType: "github",
      externalCommentId: "comment-1",
      commentKind: "status",
      lastBodyHash: "hash-b"
    });

    expect(updated.id).toBe(created.id);
    const details = await getDevelopmentTaskDetails(taskId);
    expect(details?.comments).toHaveLength(1);
    expect(details?.comments[0]).toMatchObject({
      externalCommentId: "comment-1",
      lastBodyHash: "hash-b"
    });
  });

  it("lists sandbox runner profiles with host-server targeting metadata", async () => {
    await db.insert(sandboxRunnerProfiles).values({
      id: "runner_profile_host_1",
      name: "Host Docker MVP",
      provider: "host_docker",
      serverId: "srv_foundation_1",
      image: "ghcr.io/daoflow/codex-runner:latest",
      validationCommands: ["bun run test:unit"],
      status: "disabled",
      metadata: {
        defaultTarget: "registered-host"
      }
    });

    const profiles = await listSandboxRunnerProfiles({ limit: 10 });

    expect(profiles).toEqual([
      expect.objectContaining({
        id: "runner_profile_host_1",
        provider: "host_docker",
        serverId: "srv_foundation_1",
        status: "disabled",
        metadata: {
          defaultTarget: "registered-host"
        }
      })
    ]);
  });
});
