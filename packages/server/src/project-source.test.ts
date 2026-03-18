import { generateKeyPairSync } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db/connection";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { deployments } from "./db/schema/deployments";
import { projects } from "./db/schema/projects";
import {
  createEnvironment,
  createProject,
  getProject,
  listProjects,
  updateProject
} from "./db/services/projects";
import { createService } from "./db/services/services";
import { executeRollback } from "./db/services/execute-rollback";
import { encrypt } from "./db/crypto";
import { encodeGitInstallationPermissions } from "./db/services/git-providers";
import { resetTestDatabase } from "./test-db";
import { ensureControlPlaneReady, resetControlPlaneSeedState } from "./db/services/seed";

function toRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function mockGitLabValidationFetch(input: {
  repoFullName: string;
  branch?: string;
  composePath?: string;
  projectId: number;
  projectStatus?: number;
  branchStatus?: number;
  composeStatus?: number;
}) {
  const branch = input.branch ?? "main";
  const composePath = input.composePath ?? "docker-compose.yml";
  const encodedRepoFullName = encodeURIComponent(input.repoFullName);
  const encodedProjectId = encodeURIComponent(String(input.projectId));
  const encodedBranch = encodeURIComponent(branch);
  const encodedComposePath = encodeURIComponent(composePath);
  const projectStatus = input.projectStatus ?? 200;
  const branchStatus = input.branchStatus ?? 200;
  const composeStatus = input.composeStatus ?? 200;

  return (request: string | URL | Request) => {
    const url = toRequestUrl(request);

    if (url.endsWith(`/projects/${encodedRepoFullName}`)) {
      return Promise.resolve(
        new Response(
          JSON.stringify(
            projectStatus === 200 ? { id: input.projectId } : { message: "upstream unavailable" }
          ),
          {
            status: projectStatus,
            headers: { "Content-Type": "application/json" }
          }
        )
      );
    }

    if (url.endsWith(`/projects/${encodedProjectId}/repository/branches/${encodedBranch}`)) {
      return Promise.resolve(
        new Response(
          JSON.stringify(branchStatus === 200 ? { name: branch } : { message: "missing branch" }),
          {
            status: branchStatus,
            headers: { "Content-Type": "application/json" }
          }
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
            composeStatus === 200 ? { file_path: composePath } : { message: "missing compose file" }
          ),
          {
            status: composeStatus,
            headers: { "Content-Type": "application/json" }
          }
        )
      );
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

async function insertGitLabProviderFixture(input: {
  providerId: string;
  installationId: string;
  providerName: string;
  installationToken: string;
}) {
  await db.insert(gitProviders).values({
    id: input.providerId,
    type: "gitlab",
    name: input.providerName,
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
    permissions: encodeGitInstallationPermissions({ accessToken: input.installationToken }),
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });
}

describe("project source persistence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DAOFLOW_PROVIDER_VALIDATION_TIMEOUT_MS;
  });

  it("persists dedicated git source columns and updates defaultBranch in the project row", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      type: "github",
      name: `Project Provider ${Date.now()}`,
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: "777",
      accountName: "example-org",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = toRequestUrl(input);
      if (url.endsWith("/app/installations/777/access_tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "ghs_project_source" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      if (url.endsWith("/repos/example-org/platform")) {
        return Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
      }
      if (url.endsWith("/repos/example-org/platform/branches/develop")) {
        return Promise.resolve(new Response(JSON.stringify({ name: "develop" }), { status: 200 }));
      }
      if (url.endsWith("/repos/example-org/platform/branches/release")) {
        return Promise.resolve(new Response(JSON.stringify({ name: "release" }), { status: 200 }));
      }
      if (
        url.includes(
          "/repos/example-org/platform/contents/deploy%2Fdocker-compose.prod.yml?ref=develop"
        )
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ path: "deploy/docker-compose.prod.yml" }), {
            status: 200
          })
        );
      }
      if (
        url.includes("/repos/example-org/platform/contents/ops%2Fcompose.release.yml?ref=release")
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ path: "ops/compose.release.yml" }), {
            status: 200
          })
        );
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    const created = await createProject({
      name: `Compose Source ${Date.now()}`,
      description: "Source persistence fixture",
      repoUrl: "https://github.com/example-org/platform.git",
      repoFullName: "example-org/platform",
      composePath: "deploy/docker-compose.prod.yml",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      defaultBranch: "develop",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(created.status).toBe("ok");
    if (created.status !== "ok") {
      throw new Error("Failed to create project source fixture.");
    }

    const updated = await updateProject({
      projectId: created.project.id,
      composePath: "ops/compose.release.yml",
      defaultBranch: "release",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(updated.status).toBe("ok");
    if (updated.status !== "ok") {
      throw new Error("Failed to update project source fixture.");
    }

    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, created.project.id))
      .limit(1);

    expect(row).toMatchObject({
      repoUrl: "https://github.com/example-org/platform.git",
      repoFullName: "example-org/platform",
      composePath: "ops/compose.release.yml",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      defaultBranch: "release"
    });
    expect(row.config).toMatchObject({
      description: "Source persistence fixture",
      latestDeploymentStatus: "new",
      sourceReadiness: {
        status: "ready",
        providerType: "github",
        repoFullName: "example-org/platform",
        branch: "release",
        composePath: "ops/compose.release.yml",
        checks: {
          repository: "ok",
          branch: "ok",
          composePath: "ok"
        }
      }
    });
    expect(row.config).not.toHaveProperty("defaultBranch");

    const project = await getProject(created.project.id);
    expect(project?.sourceReadiness).toMatchObject({
      status: "ready",
      providerType: "github",
      repoFullName: "example-org/platform",
      branch: "release",
      composePath: "ops/compose.release.yml"
    });

    const projectList = await listProjects();
    expect(
      projectList.find((item) => item.id === created.project.id)?.sourceReadiness
    ).toMatchObject({
      status: "ready",
      providerType: "github"
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("replays repository source metadata when creating a rollback deployment", async () => {
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      type: "gitlab",
      name: `Rollback Provider ${Date.now()}`,
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: `${Date.now()}`,
      accountName: "example-group",
      accountType: "group",
      repositorySelection: "all",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-project-source" }),
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = toRequestUrl(input);
      if (url.endsWith("/projects/example-group%2Fplatform")) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 99 }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      if (url.endsWith("/projects/99/repository/branches/main")) {
        return Promise.resolve(new Response(JSON.stringify({ name: "main" }), { status: 200 }));
      }
      if (url.includes("/projects/99/repository/files/deploy%2Fcompose.yaml?ref=main")) {
        return Promise.resolve(
          new Response(JSON.stringify({ file_path: "deploy/compose.yaml" }), { status: 200 })
        );
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    const project = await createProject({
      name: `Rollback Source ${Date.now()}`,
      repoUrl: "https://gitlab.com/example-group/platform.git",
      repoFullName: "example-group/platform",
      composePath: "deploy/compose.yaml",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      defaultBranch: "main",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(project.status).toBe("ok");
    if (project.status !== "ok") {
      throw new Error("Failed to create rollback source project.");
    }

    const environment = await createEnvironment({
      projectId: project.project.id,
      name: "production",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(environment.status).toBe("ok");
    if (environment.status !== "ok") {
      throw new Error("Failed to create rollback source environment.");
    }

    const service = await createService({
      name: "control-plane",
      projectId: project.project.id,
      environmentId: environment.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(service.status).toBe("ok");
    if (service.status !== "ok") {
      throw new Error("Failed to create rollback source service.");
    }

    const targetDeploymentId = `depok_${Date.now()}`.slice(0, 32);
    await db.insert(deployments).values({
      id: targetDeploymentId,
      projectId: project.project.id,
      environmentId: environment.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName: "control-plane",
      sourceType: "compose",
      commitSha: "abc1234",
      imageTag: "ghcr.io/daoflow/control-plane:stable",
      configSnapshot: {
        projectName: project.project.name,
        environmentName: environment.environment.name,
        targetServerName: "foundation-vps-1",
        targetServerHost: "203.0.113.24",
        deploymentSource: "git-repository",
        repoUrl: "https://gitlab.com/example-group/platform.git",
        repoFullName: "example-group/platform",
        gitProviderId: providerId,
        gitInstallationId: installationId,
        branch: "main",
        composeFilePath: "deploy/compose.yaml",
        temporalWorkflowId: "workflow-old",
        temporalRunId: "run-old"
      },
      status: "completed",
      conclusion: "succeeded",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      createdAt: new Date(Date.now() - 5 * 60_000),
      concludedAt: new Date(Date.now() - 4 * 60_000),
      updatedAt: new Date(Date.now() - 4 * 60_000)
    });

    const rollback = await executeRollback({
      serviceId: service.service.id,
      targetDeploymentId,
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(rollback.status).toBe("ok");
    if (rollback.status !== "ok") {
      throw new Error("Failed to execute rollback fixture.");
    }

    expect(rollback.deployment.configSnapshot).toMatchObject({
      deploymentSource: "git-repository",
      repoUrl: "https://gitlab.com/example-group/platform.git",
      repoFullName: "example-group/platform",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      branch: "main",
      composeFilePath: "deploy/compose.yaml"
    });
    expect(rollback.deployment.configSnapshot).not.toHaveProperty("temporalWorkflowId");
    expect(rollback.deployment.configSnapshot).not.toHaveProperty("temporalRunId");
  });

  it("rejects provider-linked projects when the configured branch is not accessible", async () => {
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      type: "gitlab",
      name: `Invalid Branch ${Date.now()}`,
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: `${Date.now()}`,
      accountName: "example-group",
      accountType: "group",
      repositorySelection: "all",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-invalid-branch" }),
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = toRequestUrl(input);
      if (url.endsWith("/projects/example-group%2Finvalid-branch")) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 101 }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      if (url.endsWith("/projects/101/repository/branches/release")) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "404 Branch Not Found" }), { status: 404 })
        );
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    const created = await createProject({
      name: `Invalid Source ${Date.now()}`,
      repoFullName: "example-group/invalid-branch",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      defaultBranch: "release",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(created).toEqual({
      status: "invalid_source",
      message: "Branch release was not found in example-group/invalid-branch."
    });

    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.repoFullName, "example-group/invalid-branch"));
    expect(rows).toHaveLength(0);
  });

  it("rejects invalid repository and compose paths before provider validation runs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const invalidRepo = await createProject({
      name: `Invalid Repo Path ${Date.now()}`,
      repoFullName: "example-org/../platform",
      gitProviderId: "gitprov_missing",
      gitInstallationId: "gitinst_missing",
      defaultBranch: "main",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(invalidRepo).toEqual({
      status: "invalid_source",
      message:
        "Provider-linked repository sources require repoFullName as a normalized slash-delimited repository path."
    });

    const invalidComposePath = await createProject({
      name: `Invalid Compose Path ${Date.now()}`,
      repoFullName: "example-org/platform",
      gitProviderId: "gitprov_missing",
      gitInstallationId: "gitinst_missing",
      composePath: "../deploy/compose.yaml",
      defaultBranch: "main",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(invalidComposePath).toEqual({
      status: "invalid_source",
      message: "Compose paths must stay within the repository root."
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies provider validation timeouts as provider_unavailable during project create", async () => {
    const providerId = `gitprov_timeout_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_timeout_${Date.now()}`.slice(0, 32);

    await insertGitLabProviderFixture({
      providerId,
      installationId,
      providerName: `Timeout Provider ${Date.now()}`,
      installationToken: "glpat-timeout"
    });

    process.env.DAOFLOW_PROVIDER_VALIDATION_TIMEOUT_MS = "5";
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true }
        );
      });
    });

    const created = await createProject({
      name: `Timeout Source ${Date.now()}`,
      repoFullName: "example-group/timeout-source",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      defaultBranch: "main",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(created).toEqual({
      status: "provider_unavailable",
      message:
        "GitLab source validation is temporarily unavailable: timed out after 5ms while checking repository access; retry when the provider is reachable."
    });

    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.repoFullName, "example-group/timeout-source"));
    expect(rows).toHaveLength(0);
  });

  it("does not overwrite stored source state when provider validation is transiently unavailable during update", async () => {
    const providerId = `gitprov_transient_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_transient_${Date.now()}`.slice(0, 32);
    const repoFullName = "example-group/update-transient";

    await insertGitLabProviderFixture({
      providerId,
      installationId,
      providerName: `Transient Provider ${Date.now()}`,
      installationToken: "glpat-transient"
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabValidationFetch({
        repoFullName,
        composePath: "deploy/compose.yml",
        projectId: 210
      })
    );

    const created = await createProject({
      name: `Transient Source ${Date.now()}`,
      repoFullName,
      gitProviderId: providerId,
      gitInstallationId: installationId,
      composePath: "deploy/compose.yml",
      defaultBranch: "main",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(created.status).toBe("ok");
    if (created.status !== "ok") {
      throw new Error("Failed to create transient update fixture.");
    }

    const [beforeUpdate] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, created.project.id))
      .limit(1);

    fetchMock.mockImplementation(
      mockGitLabValidationFetch({
        repoFullName,
        composePath: "deploy/compose.alt.yml",
        projectId: 210,
        projectStatus: 503
      })
    );

    const updated = await updateProject({
      projectId: created.project.id,
      composePath: "deploy/compose.alt.yml",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(updated).toEqual({
      status: "provider_unavailable",
      message:
        "GitLab source validation is temporarily unavailable: returned 503 while checking repository access; retry when the provider is reachable."
    });

    const [afterUpdate] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, created.project.id))
      .limit(1);

    expect(afterUpdate?.composePath).toBe("deploy/compose.yml");
    expect(afterUpdate?.defaultBranch).toBe("main");
    expect(afterUpdate?.config).toEqual(beforeUpdate?.config);
  });
});
