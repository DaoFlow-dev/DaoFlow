import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../connection";
import { sandboxRunnerProfiles } from "../schema/development-tasks";
import { servers } from "../schema/servers";
import { teams } from "../schema/teams";
import { resetSeededTestDatabase } from "../../test-db";
import { claimNextQueuedDevelopmentTask } from "./development-task-claims";
import { DEFAULT_CODEX_RUNNER_IMAGE } from "./default-development-runner";
import { createProject } from "./projects";
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

  it("deduplicates development tasks per project, not globally by repository", async () => {
    const secondProject = await createProject({
      name: `Second Dev Task Project ${Date.now()}`,
      repoUrl: "https://github.com/DaoFlow-dev/DaoFlow",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(secondProject.status).toBe("ok");
    if (secondProject.status !== "ok") {
      throw new Error("Failed to create second development task project fixture.");
    }

    const first = await queueDevelopmentTask(taskInput());
    const second = await queueDevelopmentTask(
      taskInput({
        projectId: secondProject.project.id
      })
    );

    expect(first.status).toBe("created");
    expect(second.status).toBe("created");

    const tasks = await listDevelopmentTasks({ limit: 10 });
    expect(tasks.filter((task) => task.repoFullName === "DaoFlow-dev/DaoFlow")).toHaveLength(2);
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

  it("claims the next queued task and records a claimed run without running Codex", async () => {
    const queued = await queueDevelopmentTask(taskInput());
    const claim = await claimNextQueuedDevelopmentTask({
      runnerId: "development-task-worker",
      runnerLabel: "development-task-worker"
    });

    expect(claim?.task.id).toBe(queued.task.id);
    expect(claim?.task.status).toBe("running");
    expect(claim?.run).toMatchObject({
      taskId: queued.task.id,
      status: "claimed",
      runnerId: "development-task-worker",
      runnerProfileId: "runner_profile_host_default",
      sandboxProvider: "host_docker",
      codexProfile: "daoflow"
    });
    expect(claim?.run.metadata).toMatchObject({
      runnerLabel: "development-task-worker",
      runnerProfileName: "Host Docker Default",
      image: DEFAULT_CODEX_RUNNER_IMAGE,
      serverId: "srv_foundation_1",
      cpuLimit: 2,
      memoryLimitMb: 4096,
      diskLimitMb: 20480,
      codexAuthMode: "custom_provider_env",
      capabilities: [
        "exec",
        "exec.stream",
        "files.read",
        "files.write",
        "archive.upload",
        "archive.download"
      ],
      allowedCommands: [
        "bun run format",
        "bun run test:unit",
        "bun run lint",
        "bun run typecheck",
        "bun run contracts:check"
      ],
      validationCommands: [
        "bun run format",
        "bun run test:unit",
        "bun run lint",
        "bun run typecheck",
        "bun run contracts:check"
      ]
    });

    const details = await getDevelopmentTaskDetails(queued.task.id);
    expect(details?.task.status).toBe("running");
    expect(details?.task.currentRunId).toBe(claim?.run.id);
    expect(details?.events.some((event) => event.kind === "run.claimed")).toBe(true);

    const nextClaim = await claimNextQueuedDevelopmentTask({
      runnerId: "development-task-worker",
      runnerLabel: "development-task-worker"
    });
    expect(nextClaim).toBeNull();
  });

  it("leaves queued tasks untouched when no runner profile is enabled", async () => {
    const queued = await queueDevelopmentTask(taskInput());
    await db
      .update(sandboxRunnerProfiles)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(sandboxRunnerProfiles.id, "runner_profile_host_default"));

    const claim = await claimNextQueuedDevelopmentTask({
      runnerId: "development-task-worker",
      runnerLabel: "development-task-worker"
    });

    expect(claim).toBeNull();

    const details = await getDevelopmentTaskDetails(queued.task.id);
    expect(details?.task.status).toBe("queued");
    expect(details?.runs).toHaveLength(0);
  });

  it("does not claim a task with another team's runner profile", async () => {
    const queued = await queueDevelopmentTask(taskInput());
    await db
      .update(sandboxRunnerProfiles)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(sandboxRunnerProfiles.id, "runner_profile_host_default"));
    await db.insert(teams).values({
      id: "team_dev_task_other",
      name: "Other Dev Task Team",
      slug: "other-dev-task-team"
    });
    await db.insert(servers).values({
      id: "srv_dev_task_other",
      name: "other-dev-task-host",
      host: "other-dev-task-host.local",
      region: "test",
      teamId: "team_dev_task_other",
      kind: "docker-engine",
      status: "ready",
      metadata: {}
    });
    await db.insert(sandboxRunnerProfiles).values({
      id: "runner_profile_other_team",
      name: "Other Team Runner",
      provider: "host_docker",
      serverId: "srv_dev_task_other",
      image: DEFAULT_CODEX_RUNNER_IMAGE,
      status: "enabled",
      metadata: {}
    });

    const claim = await claimNextQueuedDevelopmentTask({
      runnerId: "development-task-worker",
      runnerLabel: "development-task-worker"
    });

    expect(claim).toBeNull();

    const details = await getDevelopmentTaskDetails(queued.task.id);
    expect(details?.task.status).toBe("queued");
    expect(details?.runs).toHaveLength(0);
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
      image: DEFAULT_CODEX_RUNNER_IMAGE,
      validationCommands: ["bun run test:unit"],
      status: "disabled",
      metadata: {
        defaultTarget: "registered-host"
      }
    });

    const profiles = await listSandboxRunnerProfiles({ limit: 10 });

    expect(profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runner_profile_host_1",
          provider: "host_docker",
          serverId: "srv_foundation_1",
          status: "disabled",
          capabilities: [
            "exec",
            "exec.stream",
            "files.read",
            "files.write",
            "archive.upload",
            "archive.download"
          ],
          metadata: {
            defaultTarget: "registered-host"
          }
        })
      ])
    );
  });

  it("filters sandbox runner profiles by team-owned server", async () => {
    await db.insert(teams).values({
      id: "team_dev_task_profiles",
      name: "Other Profile Team",
      slug: "other-profile-team"
    });
    await db.insert(servers).values({
      id: "srv_dev_task_profiles",
      name: "other-profile-host",
      host: "other-profile-host.local",
      region: "test",
      teamId: "team_dev_task_profiles",
      kind: "docker-engine",
      status: "ready",
      metadata: {}
    });
    await db.insert(sandboxRunnerProfiles).values({
      id: "runner_profile_other_profiles",
      name: "Other Profile Runner",
      provider: "host_docker",
      serverId: "srv_dev_task_profiles",
      image: DEFAULT_CODEX_RUNNER_IMAGE,
      status: "enabled",
      metadata: {}
    });

    const profiles = await listSandboxRunnerProfiles({
      teamId: "team_foundation",
      limit: 20
    });

    expect(profiles.map((profile) => profile.id)).toContain("runner_profile_host_default");
    expect(profiles.map((profile) => profile.id)).not.toContain("runner_profile_other_profiles");
  });

  it("lists the BoxLite-compatible sandbox runner profile", async () => {
    const profiles = await listSandboxRunnerProfiles({ limit: 10 });
    const boxLiteProfile = profiles.find(
      (profile) => profile.id === "runner_profile_boxlite_default"
    );

    expect(boxLiteProfile).toMatchObject({
      id: "runner_profile_boxlite_default",
      provider: "sandbank_boxlite",
      serverId: "srv_foundation_1",
      status: "disabled",
      image: DEFAULT_CODEX_RUNNER_IMAGE,
      codexAuthMode: "custom_provider_env"
    });
    expect(boxLiteProfile?.metadata).toMatchObject({
      defaultTarget: "registered-host",
      hostServerDefault: true,
      sandbankProvider: "sandbank_boxlite",
      sandbankPackage: "@sandbank.dev/boxlite",
      boxliteMode: "remote"
    });
    expect(boxLiteProfile?.capabilities).toEqual(
      expect.arrayContaining(["exec.stream", "snapshot", "port.expose", "terminal", "sleep"])
    );
  });

  it("seeds an enabled default host Docker runner profile for the default host server", async () => {
    const profiles = await listSandboxRunnerProfiles({ limit: 10 });
    const seededProfile = profiles.find((profile) => profile.id === "runner_profile_host_default");

    expect(seededProfile).toMatchObject({
      id: "runner_profile_host_default",
      provider: "host_docker",
      serverId: "srv_foundation_1",
      status: "enabled",
      image: DEFAULT_CODEX_RUNNER_IMAGE,
      codexAuthMode: "custom_provider_env"
    });
    expect(seededProfile?.metadata).toMatchObject({
      defaultTarget: "registered-host",
      hostServerDefault: true,
      codexAuthModes: ["api_key", "chatgpt_auth_json", "custom_provider_env"],
      codexConfigPath: "/runner/home/.codex/config.toml",
      sandbankProvider: "host_docker",
      capabilities: [
        "exec",
        "exec.stream",
        "files.read",
        "files.write",
        "archive.upload",
        "archive.download"
      ],
      laterProvider: "sandbank_boxlite",
      laterPackage: "@sandbank.dev/boxlite",
      boxliteModes: ["remote", "local"]
    });
    expect(seededProfile?.capabilities).toContain("exec.stream");
    expect(seededProfile?.codexConfigTemplate).toContain("[profiles.daoflow]");
  });
});
