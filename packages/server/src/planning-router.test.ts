import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { Context } from "./context";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { deployments } from "./db/schema/deployments";
import { environmentVariables, projects } from "./db/schema/projects";
import { teams } from "./db/schema/teams";
import { createEnvironment, createProject } from "./db/services/projects";
import { ensureControlPlaneReady } from "./db/services/seed";
import { createService } from "./db/services/services";
import { appRouter } from "./router";
import { createLocalGitRepository } from "./test-git-repo";

let fixtureCounter = 0;

function makeSession(role: string): NonNullable<Context["session"]> {
  const seededUsers = {
    owner: {
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner"
    },
    viewer: {
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner"
    }
  } as const;
  const actor = seededUsers[role as keyof typeof seededUsers] ?? seededUsers.viewer;

  return {
    user: {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      image: null,
      role
    },
    session: {
      id: `session_${role}`,
      userId: actor.id,
      expiresAt: new Date(),
      token: `token_${role}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null
    }
  } as unknown as NonNullable<Context["session"]>;
}

async function createConfigDiffFixture(teamId = "team_foundation") {
  await ensureControlPlaneReady();

  fixtureCounter += 1;
  const suffix = `${Date.now()}_${fixtureCounter}`;
  const projectName = `config-diff-${suffix}`;
  const environmentName = `preview-${suffix}`;
  const serviceName = `svc-${suffix}`;

  if (teamId !== "team_foundation") {
    await db.insert(teams).values({
      id: teamId,
      name: `Scoped Team ${suffix}`,
      slug: `scoped-${suffix}`.slice(0, 40),
      status: "active",
      createdByUserId: "user_foundation_owner"
    });
  }

  const projectResult = await createProject({
    name: projectName,
    description: "Config diff fixture",
    teamId,
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create config diff fixture project.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: environmentName,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create config diff fixture environment.");
  }

  const serviceResult = await createService({
    name: serviceName,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create config diff fixture service.");
  }

  const baselineDeploymentId = `depbase_${suffix}`.slice(0, 32);
  const comparisonDeploymentId = `depcmp_${suffix}`.slice(0, 32);
  const baselineCreatedAt = new Date(Date.now() - 4 * 60 * 1000);
  const comparisonCreatedAt = new Date(Date.now() - 60 * 1000);

  await db.insert(deployments).values([
    {
      id: baselineDeploymentId,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName,
      sourceType: "compose",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/fixture:1.0.0",
      configSnapshot: {
        projectName,
        environmentName,
        targetServerName: "foundation-vps-1",
        targetServerHost: "203.0.113.24",
        composePath: `/srv/${serviceName}/compose.v1.yaml`,
        runtime: {
          replicas: 1,
          releaseTrack: "stable"
        }
      },
      status: "completed",
      conclusion: "succeeded",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      createdAt: baselineCreatedAt,
      concludedAt: new Date(baselineCreatedAt.getTime() + 30_000),
      updatedAt: new Date(baselineCreatedAt.getTime() + 30_000)
    },
    {
      id: comparisonDeploymentId,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName,
      sourceType: "compose",
      commitSha: "fedcba9",
      imageTag: "ghcr.io/daoflow/fixture:1.1.0",
      configSnapshot: {
        projectName,
        environmentName,
        targetServerName: "foundation-vps-1",
        targetServerHost: "203.0.113.24",
        composePath: `/srv/${serviceName}/compose.v2.yaml`,
        runtime: {
          replicas: 2,
          releaseTrack: "canary"
        }
      },
      status: "failed",
      conclusion: "failed",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      error: { message: "Fixture failure" },
      createdAt: comparisonCreatedAt,
      concludedAt: new Date(comparisonCreatedAt.getTime() + 20_000),
      updatedAt: new Date(comparisonCreatedAt.getTime() + 20_000)
    }
  ]);

  return {
    baselineDeploymentId,
    comparisonDeploymentId
  };
}

describe("planning diff surfaces", () => {
  it("returns a non-mutating direct compose deployment plan", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-plan",
      session: makeSession("viewer")
    });

    fixtureCounter += 1;
    const suffix = `${Date.now()}_${fixtureCounter}`;
    const stackName = `compose-plan-${suffix}`;
    const composeContent = `name: ${stackName}\nservices:\n  web:\n    build:\n      context: .\n`;

    const [projectBefore] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.name, stackName))
      .limit(1);

    expect(projectBefore).toBeUndefined();

    const plan = await caller.composeDeploymentPlan({
      server: "srv_foundation_1",
      compose: composeContent,
      composePath: "./fixtures/compose.yaml",
      contextPath: ".",
      localBuildContexts: [{ serviceName: "web", context: ".", dockerfile: null }],
      requiresContextUpload: true,
      contextBundle: {
        fileCount: 12,
        sizeBytes: 4096,
        includedOverrides: [".env"]
      }
    });

    expect(plan.isReady).toBe(true);
    expect(plan.project.name).toBe(stackName);
    expect(plan.project.action).toBe("create");
    expect(plan.environment.name).toBe("production");
    expect(plan.environment.action).toBe("create");
    expect(plan.service.name).toBe(stackName);
    expect(plan.service.action).toBe("create");
    expect(plan.target.serverId).toBe("srv_foundation_1");
    expect(plan.target.requiresContextUpload).toBe(true);
    expect(plan.target.contextBundle?.fileCount).toBe(12);
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        "Bundle the local build context while respecting .dockerignore rules"
      ])
    );
    expect(plan.executeCommand).toContain("--compose ./fixtures/compose.yaml");
    expect(plan.executeCommand).toContain("--server srv_foundation_1");
    expect(plan.executeCommand).toContain("--context .");

    const [projectAfter] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.name, stackName))
      .limit(1);

    expect(projectAfter).toBeUndefined();
  });

  it("surfaces env precedence and unresolved interpolation in direct compose plans", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-plan-env-diagnostics",
      session: makeSession("viewer")
    });

    fixtureCounter += 1;
    const suffix = `${Date.now()}_${fixtureCounter}`;
    const stackName = `compose-env-plan-${suffix}`;

    const projectResult = await createProject({
      name: stackName,
      description: "Compose planning env diagnostics fixture",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create compose env plan fixture project.");
    }

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: "production",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create compose env plan fixture environment.");
    }

    const serviceResult = await createService({
      name: stackName,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create compose env plan fixture service.");
    }

    await db.insert(environmentVariables).values({
      environmentId: environmentResult.environment.id,
      key: "DATABASE_URL",
      valueEncrypted: encrypt("postgres://fixture"),
      isSecret: "true",
      category: "runtime",
      branchPattern: "main",
      updatedByUserId: "user_foundation_owner"
    });

    const plan = await caller.composeDeploymentPlan({
      server: "srv_foundation_1",
      compose: [
        `name: ${stackName}`,
        "services:",
        "  api:",
        "    image: example/api:${IMAGE_TAG}",
        "    environment:",
        "      DATABASE_URL: ${DATABASE_URL?required}",
        "      OPTIONAL_VALUE: $OPTIONAL_VALUE",
        "      REQUIRED_VALUE: ${REQUIRED_VALUE?missing}"
      ].join("\n"),
      composePath: "./fixtures/compose.yaml",
      contextPath: ".",
      repoDefaultContent: "IMAGE_TAG=stable\n",
      localBuildContexts: [],
      requiresContextUpload: false
    });

    expect(plan.project.action).toBe("reuse");
    expect(plan.environment.action).toBe("reuse");
    expect(plan.service.action).toBe("reuse");
    expect(plan.composeEnvPlan.branch).toBe("main");
    expect(plan.composeEnvPlan.composeEnv.counts).toMatchObject({
      total: 2,
      repoDefaults: 1,
      environmentVariables: 1,
      secrets: 1
    });
    expect(plan.composeEnvPlan.interpolation.status).toBe("fail");
    expect(plan.composeEnvPlan.interpolation.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expression: "$OPTIONAL_VALUE",
          severity: "warn"
        }),
        expect.objectContaining({
          expression: "${REQUIRED_VALUE?missing}",
          severity: "fail"
        })
      ])
    );
    expect(plan.isReady).toBe(false);
  });

  it("builds deployment plans for generic repoUrl compose services", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-generic-repo-url",
      session: makeSession("viewer")
    });
    const repository = createLocalGitRepository({
      files: {
        "deploy/compose.yaml": "services:\n  api:\n    image: example/api:${IMAGE_TAG}\n",
        "deploy/.env": "IMAGE_TAG=stable\n"
      }
    });

    try {
      const projectResult = await createProject({
        name: `generic-plan-${Date.now()}`,
        repoUrl: repository.rootDir,
        composePath: "deploy/compose.yaml",
        defaultBranch: "main",
        teamId: "team_foundation",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (projectResult.status !== "ok") {
        throw new Error("Failed to create generic repoUrl planning fixture project.");
      }

      const environmentResult = await createEnvironment({
        projectId: projectResult.project.id,
        name: `generic-plan-env-${Date.now()}`,
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (environmentResult.status !== "ok") {
        throw new Error("Failed to create generic repoUrl planning fixture environment.");
      }

      const serviceResult = await createService({
        name: `generic-plan-svc-${Date.now()}`,
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (serviceResult.status !== "ok") {
        throw new Error("Failed to create generic repoUrl planning fixture service.");
      }

      const plan = await caller.deploymentPlan({
        service: serviceResult.service.id
      });

      expect(plan.isReady).toBe(true);
      expect(plan.composeEnvPlan?.branch).toBe("main");
      expect(plan.composeEnvPlan?.composeEnv.counts).toMatchObject({
        total: 1,
        repoDefaults: 1,
        environmentVariables: 0
      });
      expect(plan.composeEnvPlan?.interpolation.status).toBe("ok");
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "warn" && check.detail.includes("could not read deploy/compose.yaml")
        )
      ).toBe(false);
    } finally {
      repository.cleanup();
    }
  });

  it("warns when compose healthcheckPath is configured but execution only uses compose container state", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-compose-healthcheck-advisory",
      session: makeSession("viewer")
    });
    const repository = createLocalGitRepository({
      files: {
        "deploy/compose.yaml": "services:\n  api:\n    image: example/api:${IMAGE_TAG}\n",
        "deploy/.env": "IMAGE_TAG=stable\n"
      }
    });

    try {
      const projectResult = await createProject({
        name: `compose-health-plan-${Date.now()}`,
        repoUrl: repository.rootDir,
        composePath: "deploy/compose.yaml",
        defaultBranch: "main",
        teamId: "team_foundation",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (projectResult.status !== "ok") {
        throw new Error("Failed to create compose health planning fixture project.");
      }

      const environmentResult = await createEnvironment({
        projectId: projectResult.project.id,
        name: `compose-health-env-${Date.now()}`,
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (environmentResult.status !== "ok") {
        throw new Error("Failed to create compose health planning fixture environment.");
      }

      const serviceResult = await createService({
        name: `compose-health-svc-${Date.now()}`,
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        targetServerId: "srv_foundation_1",
        healthcheckPath: "/ready",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (serviceResult.status !== "ok") {
        throw new Error("Failed to create compose health planning fixture service.");
      }

      const plan = await caller.deploymentPlan({
        service: serviceResult.service.id
      });

      expect(plan.isReady).toBe(true);
      expect(plan.steps).toContain(
        "Verify Docker Compose container state and Docker health, then mark the rollout outcome"
      );
      expect(plan.steps).not.toContain(
        "Run configured health check and promote only if it stays green"
      );
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "warn" &&
            check.detail.includes('healthcheckPath "/ready" is advisory only today')
        )
      ).toBe(true);
    } finally {
      repository.cleanup();
    }
  });

  it("returns a scoped config diff from the planning lane", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-config-diff",
      session: makeSession("viewer")
    });
    const fixture = await createConfigDiffFixture();

    const diff = await caller.configDiff({
      deploymentIdA: fixture.baselineDeploymentId,
      deploymentIdB: fixture.comparisonDeploymentId
    });

    expect(diff.a.id).toBe(fixture.baselineDeploymentId);
    expect(diff.b.id).toBe(fixture.comparisonDeploymentId);
    expect(diff.summary.sameProject).toBe(true);
    expect(diff.summary.sameEnvironment).toBe(true);
    expect(diff.summary.sameService).toBe(true);
    expect(diff.scalarChanges.map((change) => change.key)).toEqual(
      expect.arrayContaining(["commitSha", "imageTag", "statusLabel"])
    );
    expect(diff.snapshotChanges.map((change) => change.key)).toEqual(
      expect.arrayContaining(["composePath", "runtime"])
    );
  });

  it("keeps deploymentDiff as a scoped compatibility alias", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-deployment-diff-alias",
      session: makeSession("viewer")
    });
    const fixture = await createConfigDiffFixture();

    const diff = await caller.deploymentDiff({
      deploymentIdA: fixture.baselineDeploymentId,
      deploymentIdB: fixture.comparisonDeploymentId
    });

    expect(diff.summary.changedScalarCount).toBeGreaterThanOrEqual(3);
    expect(diff.summary.changedSnapshotKeyCount).toBeGreaterThanOrEqual(2);
  });

  it("rejects config diff requests outside the caller team scope", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-config-diff-out-of-scope",
      session: makeSession("viewer")
    });
    const outsiderFixture = await createConfigDiffFixture(`team_scope_${Date.now().toString(36)}`);

    await expect(
      caller.configDiff({
        deploymentIdA: outsiderFixture.baselineDeploymentId,
        deploymentIdB: outsiderFixture.comparisonDeploymentId
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<TRPCError>);
  });
});
