import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "./app";
import { db } from "./db/connection";
import { deployments } from "./db/schema/deployments";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { environments, projects } from "./db/schema/projects";
import { encodeGitInstallationPermissions } from "./db/services/git-providers";
import {
  encryptComposeDeploymentState,
  readDeploymentComposeEnvEntries,
  readDeploymentComposeState
} from "./db/services/compose-env";
import { asRecord } from "./db/services/json-helpers";
import { upsertEnvironmentVariable } from "./db/services/envvars";
import { createEnvironment, createProject } from "./db/services/projects";
import { ensureControlPlaneReady, resetControlPlaneSeedState } from "./db/services/seed";
import { createService } from "./db/services/services";
import { triggerDeploy } from "./db/services/trigger-deploy";
import { resetTestDatabase } from "./test-db";
import { createLocalGitRepository } from "./test-git-repo";

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

async function createDirectUploadComposeFixture(input: {
  projectName: string;
  serviceName?: string;
}) {
  const projectResult = await createProject({
    name: `${input.projectName} ${Date.now()}`,
    description: "Direct upload compose fixture",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create direct-upload project fixture.");
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
    throw new Error("Failed to create direct-upload environment fixture.");
  }

  const serviceResult = await createService({
    name: input.serviceName ?? "uploaded-runtime",
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(serviceResult.status).toBe("ok");
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create direct-upload service fixture.");
  }

  return {
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    serviceId: serviceResult.service.id,
    serviceName: serviceResult.service.name
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

    await upsertEnvironmentVariable({
      environmentId: fixture.environmentId,
      key: "PREVIEW_FLAG",
      value: "enabled",
      isSecret: false,
      category: "runtime",
      branchPattern: "main",
      updatedByUserId: "user_foundation_owner",
      updatedByEmail: "owner@daoflow.local",
      updatedByRole: "owner"
    });

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
    expect(asRecord(result.deployment.configSnapshot).composeEnv).toMatchObject({
      status: "queued",
      branch: "main",
      fileName: ".daoflow.compose.env",
      counts: {
        total: 1,
        environmentVariables: 1,
        runtime: 1
      }
    });
    expect(readDeploymentComposeEnvEntries(result.deployment.envVarsEncrypted)).toEqual([
      {
        key: "PREVIEW_FLAG",
        value: "enabled",
        category: "runtime",
        isSecret: false,
        source: "inline",
        branchPattern: "main"
      }
    ]);
    expect(result.deployment.steps.map((step) => step.detail)).toEqual(
      expect.arrayContaining([
        "docker-compose pull",
        "docker-compose up -d",
        "Verify Docker Compose container state and Docker health"
      ])
    );

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

  it("freezes explicit compose readiness probes into deployment snapshots", async () => {
    const repository = createLocalGitRepository({
      files: {
        "deploy/compose.yaml": "services:\n  api:\n    image: example/api:${IMAGE_TAG}\n",
        "deploy/.env": "IMAGE_TAG=stable\n"
      }
    });

    try {
      const projectResult = await createProject({
        name: `Readiness Snapshot ${Date.now()}`,
        repoUrl: repository.rootDir,
        composePath: "deploy/compose.yaml",
        defaultBranch: "main",
        teamId: "team_foundation",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(projectResult.status).toBe("ok");
      if (projectResult.status !== "ok") {
        throw new Error("Failed to create readiness snapshot project fixture.");
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
        throw new Error("Failed to create readiness snapshot environment fixture.");
      }

      const serviceResult = await createService({
        name: "compose-runtime",
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        composeServiceName: "api",
        readinessProbe: {
          type: "http",
          target: "published-port",
          port: 8080,
          path: "/ready",
          successStatusCodes: [200, 204]
        },
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      expect(serviceResult.status).toBe("ok");
      if (serviceResult.status !== "ok") {
        throw new Error("Failed to create readiness snapshot service fixture.");
      }

      const result = await triggerDeploy({
        serviceId: serviceResult.service.id,
        commitSha: "abcdef1234567890abcdef1234567890abcdef12",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });

      expect(result.status).toBe("ok");
      if (result.status !== "ok") {
        throw new Error("Expected readiness snapshot deployment to succeed.");
      }

      expect(asRecord(result.deployment.configSnapshot).readinessProbe).toMatchObject({
        serviceName: "api",
        type: "http",
        target: "published-port",
        host: "127.0.0.1",
        scheme: "http",
        port: 8080,
        path: "/ready",
        timeoutSeconds: 60,
        intervalSeconds: 3,
        successStatusCodes: [200, 204]
      });
      expect(result.deployment.steps.map((step) => step.detail)).toEqual(
        expect.arrayContaining([
          "Verify Docker Compose container state, Docker health, and HTTP readiness on http://127.0.0.1:8080/ready expecting 200, 204 within 60s (poll every 3s)"
        ])
      );
    } finally {
      repository.cleanup();
    }
  });

  it("replays retained uploaded artifact snapshots for direct-upload compose services", async () => {
    const fixture = await createDirectUploadComposeFixture({
      projectName: "Direct Upload Replay",
      serviceName: "direct-upload-service"
    });

    const directUploadState = encryptComposeDeploymentState({
      envEntries: [
        {
          key: "UPLOADED_FLAG",
          value: "1",
          category: "runtime",
          isSecret: false,
          source: "inline",
          branchPattern: null
        }
      ],
      frozenInputs: {
        composeFile: {
          path: ".daoflow.compose.rendered.yaml",
          sourcePath: "compose.yaml",
          contents: "services:\n  app:\n    image: nginx:alpine\n"
        },
        envFiles: []
      }
    });

    await db.insert(deployments).values({
      id: `depup_old_${Date.now()}`.slice(0, 32),
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      targetServerId: "srv_foundation_1",
      serviceName: fixture.serviceName,
      sourceType: "compose",
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      imageTag: "ghcr.io/daoflow/direct-upload:stable",
      envVarsEncrypted: directUploadState,
      configSnapshot: {
        deploymentSource: "uploaded-context",
        composeFilePath: "compose.yaml",
        uploadedComposeFileName: "compose.yaml",
        uploadedContextArchiveName: "context.tar.gz"
      },
      status: "completed",
      conclusion: "succeeded",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      createdAt: new Date(Date.now() - 120_000),
      concludedAt: new Date(Date.now() - 119_000),
      updatedAt: new Date(Date.now() - 119_000)
    });

    await db.insert(deployments).values({
      id: `depup_new_${Date.now()}`.slice(0, 32),
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      targetServerId: "srv_foundation_1",
      serviceName: fixture.serviceName,
      sourceType: "compose",
      commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      imageTag: "ghcr.io/daoflow/direct-upload:newer",
      envVarsEncrypted: directUploadState,
      configSnapshot: {
        deploymentSource: "uploaded-context",
        composeFilePath: "compose.yaml",
        uploadedComposeFileName: "compose.yaml",
        uploadedContextArchiveName: "context.tar.gz",
        uploadedArtifactId: "0123456789abcdef0123456789abcdef",
        queueName: "docker-ssh",
        temporalWorkflowId: "workflow-old",
        temporalRunId: "run-old"
      },
      status: "failed",
      conclusion: "failed",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      createdAt: new Date(Date.now() - 60_000),
      concludedAt: new Date(Date.now() - 59_000),
      updatedAt: new Date(Date.now() - 59_000)
    });

    const result = await triggerDeploy({
      serviceId: fixture.serviceId,
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected direct-upload trigger replay to succeed.");
    }

    expect(result.deployment.commitSha).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(result.deployment.imageTag).toBe("ghcr.io/daoflow/direct-upload:newer");
    expect(asRecord(result.deployment.configSnapshot)).toMatchObject({
      deploymentSource: "uploaded-context",
      composeFilePath: "compose.yaml",
      uploadedComposeFileName: "compose.yaml",
      uploadedContextArchiveName: "context.tar.gz",
      uploadedArtifactId: "0123456789abcdef0123456789abcdef",
      composeImageOverride: {
        serviceName: "direct-upload-service",
        imageReference: "ghcr.io/daoflow/direct-upload:newer"
      }
    });
    expect(asRecord(result.deployment.configSnapshot)).not.toHaveProperty("temporalWorkflowId");
    expect(asRecord(result.deployment.configSnapshot)).not.toHaveProperty("temporalRunId");
    expect(readDeploymentComposeState(result.deployment.envVarsEncrypted)).toMatchObject({
      envState: {
        kind: "queued",
        entries: [
          {
            key: "UPLOADED_FLAG",
            value: "1",
            category: "runtime",
            isSecret: false,
            source: "inline",
            branchPattern: null
          }
        ]
      },
      frozenInputs: {
        composeFile: {
          path: ".daoflow.compose.rendered.yaml",
          sourcePath: "compose.yaml",
          contents: "services:\n  app:\n    image: nginx:alpine\n"
        },
        envFiles: []
      }
    });
  });

  it("blocks direct-upload redeploys when no retained artifact snapshot is available", async () => {
    const fixture = await createDirectUploadComposeFixture({
      projectName: "Direct Upload Missing Replay",
      serviceName: "missing-direct-upload-service"
    });

    await db.insert(deployments).values({
      id: `depup_legacy_${Date.now()}`.slice(0, 32),
      projectId: fixture.projectId,
      environmentId: fixture.environmentId,
      targetServerId: "srv_foundation_1",
      serviceName: fixture.serviceName,
      sourceType: "compose",
      commitSha: "",
      imageTag: "",
      configSnapshot: {
        deploymentSource: "uploaded-compose",
        composeFilePath: "compose.yaml",
        uploadedComposeFileName: "compose.yaml"
      },
      status: "completed",
      conclusion: "succeeded",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      createdAt: new Date(Date.now() - 60_000),
      concludedAt: new Date(Date.now() - 59_000),
      updatedAt: new Date(Date.now() - 59_000)
    });

    const result = await triggerDeploy({
      serviceId: fixture.serviceId,
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(result).toEqual({
      status: "invalid_source",
      message:
        "Service missing-direct-upload-service has no repository source and no retained uploaded artifact snapshot available for replay. Re-upload the compose source before triggering a redeploy."
    });

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, fixture.projectId));
    expect(queued).toHaveLength(1);
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
