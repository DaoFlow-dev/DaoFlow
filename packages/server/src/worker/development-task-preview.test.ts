import { describe, expect, it, vi } from "vitest";
import {
  createDevelopmentTaskRun,
  queueDevelopmentTask,
  updateDevelopmentTaskRun
} from "../db/services/development-tasks";
import { createEnvironment, createProject } from "../db/services/projects";
import { createService } from "../db/services/services";
import { resetSeededTestDatabase } from "../test-db";
import { queueDevelopmentTaskPreviewDeployments } from "./development-task-preview";

async function createPreviewFixture() {
  await resetSeededTestDatabase();
  const suffix = `${Date.now()}`;
  const projectResult = await createProject({
    name: `Preview Task ${suffix}`,
    repoUrl: "https://github.com/example/preview-task",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create preview project.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    teamId: "team_foundation",
    name: `preview-${suffix}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(environmentResult.status).toBe("ok");
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create preview environment.");
  }

  const serviceResult = await createService({
    name: "web",
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    composeServiceName: "web",
    targetServerId: "srv_foundation_1",
    preview: {
      enabled: true,
      mode: "pull-request",
      domainTemplate: "pr-{pr}.preview.example.test"
    },
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(serviceResult.status).toBe("ok");
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create preview service.");
  }

  const queued = await queueDevelopmentTask({
    providerType: "github",
    projectId: projectResult.project.id,
    repoFullName: "example/preview-task",
    externalIssueId: "185",
    issueNumber: 185,
    issueUrl: "https://github.com/example/preview-task/issues/185",
    issueTitle: "Preview handoff",
    requestedByExternalUser: "octocat"
  });
  expect(queued.status).toBe("created");
  if (queued.status !== "created") {
    throw new Error("Failed to queue development task.");
  }

  const run = await createDevelopmentTaskRun({ taskId: queued.task.id });
  const updatedRun = await updateDevelopmentTaskRun({
    runId: run.id,
    status: "deploying_preview",
    branchName: "daoflow/issue-185-preview",
    commitSha: "abc123",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/example/preview-task/pull/42"
  });
  if (!updatedRun) {
    throw new Error("Failed to update development task run.");
  }

  return { task: queued.task, run: updatedRun, service: serviceResult.service };
}

describe("development task preview deployments", () => {
  it("queues pull request previews for preview-enabled compose services", async () => {
    const fixture = await createPreviewFixture();
    const triggerDeployFn = vi.fn().mockResolvedValue({
      status: "ok" as const,
      deployment: {
        id: "dep_preview_42",
        configSnapshot: {
          preview: {
            target: "pull-request",
            action: "deploy",
            key: "pr-42",
            branch: "daoflow/issue-185-preview",
            pullRequestNumber: 42,
            envBranch: "preview/pr-42",
            stackName: "preview-pr-42",
            primaryDomain: "pr-42.preview.example.test"
          }
        }
      }
    });

    const result = await queueDevelopmentTaskPreviewDeployments({
      task: fixture.task,
      run: fixture.run,
      triggerDeployFn
    });

    expect(result).toMatchObject({
      status: "queued",
      previewDeploymentId: "dep_preview_42",
      previewUrl: "https://pr-42.preview.example.test"
    });
    expect(triggerDeployFn).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: fixture.service.id,
        commitSha: "abc123",
        preview: {
          target: "pull-request",
          branch: "daoflow/issue-185-preview",
          pullRequestNumber: 42,
          action: "deploy"
        }
      })
    );
  });
});
