import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db/connection";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { deployments } from "./db/schema/deployments";
import { projects } from "./db/schema/projects";
import { createEnvironment, createProject, updateProject } from "./db/services/projects";
import { createService } from "./db/services/services";
import { executeRollback } from "./db/services/execute-rollback";
import { resetTestDatabase } from "./test-db";
import { ensureControlPlaneReady, resetControlPlaneSeedState } from "./db/services/seed";

describe("project source persistence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();
  });

  it("persists dedicated git source columns and updates defaultBranch in the project row", async () => {
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      type: "github",
      name: `Project Provider ${Date.now()}`,
      appId: "123456",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: `${Date.now()}`,
      accountName: "example-org",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
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
      latestDeploymentStatus: "new"
    });
    expect(row.config).not.toHaveProperty("defaultBranch");
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
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
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
});
