import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { createDevelopmentTaskRun, queueDevelopmentTask } from "../db/services/development-tasks";
import { encodeGitInstallationPermissions } from "../db/services/git-providers";
import { createProject } from "../db/services/projects";
import { resetSeededTestDatabase } from "../test-db";
import { createGitLabDevelopmentTaskMergeRequest } from "./development-task-merge-request-gitlab";

async function createGitLabMergeRequestFixture() {
  await resetSeededTestDatabase();
  const suffix = `${Date.now()}`;
  const repoFullName = "example/development-task-mr";
  const projectResult = await createProject({
    name: `Development Task MR ${suffix}`,
    repoUrl: `https://gitlab.example.com/${repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create project.");
  }

  const [provider] = await db
    .insert(gitProviders)
    .values({
      id: `gitprov_mr_${suffix}`.slice(0, 32),
      teamId: "team_foundation",
      type: "gitlab",
      name: `GitLab MR ${suffix}`,
      baseUrl: "https://gitlab.example.com",
      status: "active",
      updatedAt: new Date()
    })
    .returning();
  const [installation] = await db
    .insert(gitInstallations)
    .values({
      id: `gitinst_mr_${suffix}`.slice(0, 32),
      teamId: "team_foundation",
      providerId: provider.id,
      installationId: "example",
      accountName: "example",
      accountType: "organization",
      repositorySelection: "selected",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-merge-request" }),
      status: "active",
      updatedAt: new Date()
    })
    .returning();

  const [project] = await db
    .update(projects)
    .set({
      repoFullName,
      gitProviderId: provider.id,
      gitInstallationId: installation.id,
      defaultBranch: "main",
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id))
    .returning();

  const queued = await queueDevelopmentTask({
    providerType: "gitlab",
    providerInstallationId: installation.id,
    projectId: project.id,
    repoFullName,
    externalIssueId: "mr-task-issue",
    issueNumber: 185,
    issueUrl: `https://gitlab.example.com/${repoFullName}/-/issues/185`,
    issueTitle: "Open a merge request from the runner",
    requestedByExternalUser: "octocat"
  });
  expect(queued.status).toBe("created");
  if (queued.status !== "created") {
    throw new Error("Expected development task to be created.");
  }

  const run = await createDevelopmentTaskRun({
    taskId: queued.task.id,
    sandboxProvider: "host_docker"
  });

  return { provider, installation, task: queued.task, run };
}

describe("createGitLabDevelopmentTaskMergeRequest", () => {
  it("creates a GitLab merge request with the stored installation token", async () => {
    const fixture = await createGitLabMergeRequestFixture();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce((_url, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        Authorization: "Bearer glpat-merge-request"
      });
      if (typeof init?.body !== "string") {
        throw new Error("Expected JSON merge request body.");
      }

      const body = JSON.parse(init.body) as {
        title?: string;
        source_branch?: string;
        target_branch?: string;
        description?: string;
        remove_source_branch?: boolean;
      };
      expect(body.title).toBe("DaoFlow task: Open a merge request from the runner");
      expect(body.source_branch).toBe("daoflow/issue-185-gitlab");
      expect(body.target_branch).toBe("main");
      expect(body.description).toContain("Preview: pending");
      expect(body.remove_source_branch).toBe(false);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            iid: 7,
            web_url: "https://gitlab.example.com/example/development-task-mr/-/merge_requests/7"
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" }
          }
        )
      );
    });

    const result = await createGitLabDevelopmentTaskMergeRequest({
      provider: fixture.provider,
      installation: fixture.installation,
      task: fixture.task,
      run: fixture.run,
      branchName: "daoflow/issue-185-gitlab",
      validationStatus: "ok"
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gitlab.example.com/api/v4/projects/example%2Fdevelopment-task-mr/merge_requests"
    );
    expect(result).toEqual({
      pullRequestNumber: 7,
      pullRequestUrl: "https://gitlab.example.com/example/development-task-mr/-/merge_requests/7"
    });
  });
});
