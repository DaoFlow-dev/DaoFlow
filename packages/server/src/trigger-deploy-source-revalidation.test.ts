import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "./app";
import { db } from "./db/connection";
import { deployments } from "./db/schema/deployments";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { environments, projects } from "./db/schema/projects";
import { encodeGitInstallationPermissions } from "./db/services/git-providers";
import { asRecord } from "./db/services/json-helpers";
import { createEnvironment, createProject } from "./db/services/projects";
import { ensureControlPlaneReady, resetControlPlaneSeedState } from "./db/services/seed";
import { createService } from "./db/services/services";
import { triggerDeploy } from "./db/services/trigger-deploy";
import { resetTestDatabase } from "./test-db";

function toRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function mockGitLabSourceFetch(input: {
  repoFullName: string;
  branch?: string;
  composePath: string;
  projectId: number;
  branchMissing?: boolean;
  composeMissing?: boolean;
}) {
  const branch = input.branch ?? "main";
  const encodedRepoFullName = encodeURIComponent(input.repoFullName);
  const encodedProjectId = encodeURIComponent(String(input.projectId));
  const encodedBranch = encodeURIComponent(branch);
  const encodedComposePath = encodeURIComponent(input.composePath);

  return (request: string | URL | Request) => {
    const url = toRequestUrl(request);

    if (url.endsWith(`/projects/${encodedRepoFullName}`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: input.projectId }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    if (url.endsWith(`/projects/${encodedProjectId}/repository/branches/${encodedBranch}`)) {
      return Promise.resolve(
        new Response(
          JSON.stringify(
            input.branchMissing ? { message: "404 Branch Not Found" } : { name: branch }
          ),
          { status: input.branchMissing ? 404 : 200 }
        )
      );
    }

    if (
      url.includes(
        `/projects/${encodedProjectId}/repository/files/${encodedComposePath}?ref=${encodedBranch}`
      )
    ) {
      return Promise.resolve(
        new Response(
          JSON.stringify(
            input.composeMissing
              ? { message: "404 File Not Found" }
              : { file_path: input.composePath }
          ),
          { status: input.composeMissing ? 404 : 200 }
        )
      );
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

async function createGitLabComposeFixture(input: {
  projectName: string;
  repoFullName: string;
  composePath: string;
  providerId: string;
  installationId: string;
  repositorySubmodules?: boolean;
  repositoryGitLfs?: boolean;
  webhookSecret?: string;
  serviceName?: string;
  autoDeploy?: boolean;
}) {
  await db.insert(gitProviders).values({
    id: input.providerId,
    type: "gitlab",
    name: `${input.projectName} Provider ${input.providerId}`,
    webhookSecret: input.webhookSecret ?? null,
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: input.installationId,
    providerId: input.providerId,
    installationId: `${Date.now()}`,
    accountName: "example-group",
    accountType: "group",
    repositorySelection: "all",
    permissions: encodeGitInstallationPermissions({ accessToken: "glpat-revalidate" }),
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });

  const projectResult = await createProject({
    name: `${input.providerId} ${input.projectName}`,
    repoUrl: `https://gitlab.com/${input.repoFullName}.git`,
    repoFullName: input.repoFullName,
    composePath: input.composePath,
    gitProviderId: input.providerId,
    gitInstallationId: input.installationId,
    defaultBranch: "main",
    repositorySubmodules: input.repositorySubmodules,
    repositoryGitLfs: input.repositoryGitLfs,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create provider-linked project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: "production",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(environmentResult.status).toBe("ok");
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create provider-linked environment fixture.");
  }

  const serviceResult = await createService({
    name: input.serviceName ?? "compose-runtime",
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(serviceResult.status).toBe("ok");
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create provider-linked service fixture.");
  }

  if (input.autoDeploy) {
    await db
      .update(projects)
      .set({
        autoDeploy: true,
        autoDeployBranch: "main",
        updatedAt: new Date()
      })
      .where(eq(projects.id, projectResult.project.id));
  }

  return {
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    serviceId: serviceResult.service.id
  };
}

describe("deploy source revalidation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("revalidates the resolved compose path before manual deploy queueing", async () => {
    const repoFullName = `example-group/revalidate-manual-${Date.now()}`;
    const providerId = `gitprov_${Date.now()}_manual`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}_manual`.slice(0, 32);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabSourceFetch({
        repoFullName,
        composePath: "deploy/compose.yaml",
        projectId: 401
      })
    );

    const fixture = await createGitLabComposeFixture({
      projectName: "Revalidate Manual",
      repoFullName,
      composePath: "deploy/compose.yaml",
      providerId,
      installationId,
      repositorySubmodules: true,
      repositoryGitLfs: true
    });

    const [projectRow] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, fixture.projectId))
      .limit(1);
    const sourceReadiness = asRecord(projectRow?.config).sourceReadiness;
    expect(sourceReadiness).toBeTruthy();

    await db
      .update(projects)
      .set({
        composePath: null,
        config: {
          ...asRecord(projectRow?.config),
          sourceReadiness: {
            ...asRecord(sourceReadiness),
            checkedAt: "2000-01-01T00:00:00.000Z",
            composePath: "deploy/compose.yaml"
          }
        },
        updatedAt: new Date()
      })
      .where(eq(projects.id, fixture.projectId));

    await db
      .update(environments)
      .set({
        config: {
          targetServerId: "srv_foundation_1",
          composeFilePath: "ops/release.yaml"
        },
        updatedAt: new Date()
      })
      .where(eq(environments.id, fixture.environmentId));

    fetchMock.mockImplementation(
      mockGitLabSourceFetch({
        repoFullName,
        composePath: "ops/release.yaml",
        projectId: 401
      })
    );

    const result = await triggerDeploy({
      serviceId: fixture.serviceId,
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected manual deploy revalidation to succeed.");
    }

    expect(asRecord(result.deployment.configSnapshot).composeFilePath).toBe("ops/release.yaml");
    expect(asRecord(asRecord(result.deployment.configSnapshot).repositoryPreparation)).toEqual({
      submodules: true,
      gitLfs: true
    });

    const [updatedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, fixture.projectId))
      .limit(1);

    expect(asRecord(asRecord(updatedProject?.config).sourceReadiness)).toMatchObject({
      status: "ready",
      composePath: "ops/release.yaml"
    });
    expect(asRecord(asRecord(updatedProject?.config).sourceReadiness).checks).toMatchObject({
      repository: "ok",
      branch: "ok",
      composePath: "ok"
    });
    expect(asRecord(asRecord(updatedProject?.config).sourceReadiness).checkedAt).not.toBe(
      "2000-01-01T00:00:00.000Z"
    );
  });

  it("blocks manual deploy dispatch when the provider-linked branch has drifted away", async () => {
    const repoFullName = `example-group/revalidate-invalid-branch-${Date.now()}`;
    const providerId = `gitprov_${Date.now()}_branch`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}_branch`.slice(0, 32);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabSourceFetch({
        repoFullName,
        composePath: "deploy/compose.yaml",
        projectId: 402
      })
    );

    const fixture = await createGitLabComposeFixture({
      projectName: "Revalidate Invalid Branch",
      repoFullName,
      composePath: "deploy/compose.yaml",
      providerId,
      installationId,
      serviceName: "invalid-branch-service"
    });

    fetchMock.mockImplementation(
      mockGitLabSourceFetch({
        repoFullName,
        composePath: "deploy/compose.yaml",
        projectId: 402,
        branchMissing: true
      })
    );

    const result = await triggerDeploy({
      serviceId: fixture.serviceId,
      commitSha: "1234567890abcdef1234567890abcdef12345678",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(result).toMatchObject({
      status: "invalid_source",
      message: `Branch main was not found in ${repoFullName}.`
    });

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, fixture.projectId));
    expect(queued).toHaveLength(0);

    const [updatedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, fixture.projectId))
      .limit(1);

    expect(asRecord(asRecord(updatedProject?.config).sourceReadiness)).toMatchObject({
      status: "invalid",
      repoFullName
    });
    expect(asRecord(asRecord(updatedProject?.config).sourceReadiness).checks).toMatchObject({
      repository: "ok",
      branch: "failed",
      composePath: "skipped"
    });
  });

  it("blocks manual deploy dispatch when provider validation is transiently unavailable", async () => {
    const repoFullName = `example-group/revalidate-provider-unavailable-${Date.now()}`;
    const providerId = `gitprov_${Date.now()}_transient`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}_transient`.slice(0, 32);
    const commitSha = "1234512345123451234512345123451234512345";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabSourceFetch({
        repoFullName,
        composePath: "deploy/compose.yaml",
        projectId: 403
      })
    );

    const fixture = await createGitLabComposeFixture({
      projectName: "Revalidate Provider Unavailable",
      repoFullName,
      composePath: "deploy/compose.yaml",
      providerId,
      installationId,
      serviceName: "provider-unavailable-service"
    });

    const [projectBeforeDeploy] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, fixture.projectId))
      .limit(1);

    fetchMock.mockImplementation((request) => {
      const url = toRequestUrl(request);
      if (url.endsWith(`/projects/${encodeURIComponent(repoFullName)}`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "upstream unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    const result = await triggerDeploy({
      serviceId: fixture.serviceId,
      commitSha,
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(result).toEqual({
      status: "provider_unavailable",
      message:
        "GitLab source validation is temporarily unavailable: returned 503 while checking repository access; retry when the provider is reachable."
    });

    const queued = await db.select().from(deployments).where(eq(deployments.commitSha, commitSha));
    expect(queued).toHaveLength(0);

    const [updatedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, fixture.projectId))
      .limit(1);

    expect(updatedProject?.config).toEqual(projectBeforeDeploy?.config);
  });

  it("marks webhook targets as failed when the provider-linked compose file is no longer reachable", async () => {
    const repoFullName = `example-group/revalidate-webhook-${Date.now()}`;
    const providerId = `gitprov_${Date.now()}_webhook`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}_webhook`.slice(0, 32);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabSourceFetch({
        repoFullName,
        composePath: "deploy/compose.yaml",
        projectId: 403
      })
    );

    const fixture = await createGitLabComposeFixture({
      projectName: "Revalidate Webhook",
      repoFullName,
      composePath: "deploy/compose.yaml",
      providerId,
      installationId,
      webhookSecret: "gitlab-revalidate-secret",
      serviceName: "webhook-revalidate-service",
      autoDeploy: true
    });

    fetchMock.mockImplementation(
      mockGitLabSourceFetch({
        repoFullName,
        composePath: "deploy/compose.yaml",
        projectId: 403,
        composeMissing: true
      })
    );

    const app = createApp();
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "fedcba0987654321fedcba0987654321fedcba09",
      project: { path_with_namespace: repoFullName },
      user_name: "gitlab-bot"
    });

    const response = await app.request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Token": "gitlab-revalidate-secret"
      },
      body: payload
    });
    const body = (await response.json()) as {
      ok: boolean;
      deployments: number;
      failedTargets: number;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deployments).toBe(0);
    expect(body.failedTargets).toBe(1);

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, fixture.projectId));
    expect(queued).toHaveLength(0);

    const [updatedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, fixture.projectId))
      .limit(1);

    expect(asRecord(asRecord(updatedProject?.config).sourceReadiness)).toMatchObject({
      status: "invalid",
      repoFullName
    });
    expect(asRecord(asRecord(updatedProject?.config).sourceReadiness).checks).toMatchObject({
      repository: "ok",
      branch: "ok",
      composePath: "failed"
    });
  });
});
