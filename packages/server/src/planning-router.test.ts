import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { Context } from "./context";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { deployments } from "./db/schema/deployments";
import { environmentVariables, projects } from "./db/schema/projects";
import { servers } from "./db/schema/servers";
import { services as servicesTable } from "./db/schema/services";
import { teams } from "./db/schema/teams";
import { encryptComposeDeploymentState } from "./db/services/compose-env";
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
        "Bundle the local build context while respecting .dockerignore rules",
        "Build staged compose services on foundation-vps-1",
        "Run docker compose up -d on foundation-vps-1"
      ])
    );
    expect(plan.steps).not.toContain("Run docker compose up -d --build on foundation-vps-1");
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

  it("includes an explicit pull step for mixed direct compose deployment plans", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-plan-mixed",
      session: makeSession("viewer")
    });

    fixtureCounter += 1;
    const suffix = `${Date.now()}_${fixtureCounter}`;
    const stackName = `compose-plan-mixed-${suffix}`;
    const composeContent = [
      `name: ${stackName}`,
      "services:",
      "  web:",
      "    build:",
      "      context: .",
      "  worker:",
      "    image: nginx:alpine"
    ].join("\n");

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
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        "Pull compose images on foundation-vps-1",
        "Build staged compose services on foundation-vps-1",
        "Run docker compose up -d on foundation-vps-1"
      ])
    );
  });

  it("uses docker stack deploy wording for swarm manager direct compose plans", async () => {
    await db
      .update(servers)
      .set({ kind: "docker-swarm-manager" })
      .where(eq(servers.id, "srv_foundation_1"));

    try {
      const caller = appRouter.createCaller({
        requestId: "test-compose-plan-swarm",
        session: makeSession("viewer")
      });

      fixtureCounter += 1;
      const suffix = `${Date.now()}_${fixtureCounter}`;
      const stackName = `compose-plan-swarm-${suffix}`;

      const plan = await caller.composeDeploymentPlan({
        server: "srv_foundation_1",
        compose: [`name: ${stackName}`, "services:", "  web:", "    image: nginx:alpine"].join(
          "\n"
        ),
        composePath: "./fixtures/compose.yaml",
        requiresContextUpload: false,
        localBuildContexts: []
      });

      expect(plan.isReady).toBe(true);
      expect(plan.target.targetKind).toBe("docker-swarm-manager");
      expect(plan.steps).toContain(`Run docker stack deploy for ${stackName} on foundation-vps-1`);
      expect(
        plan.preflightChecks.some((check) => check.detail.includes("docker-swarm-manager"))
      ).toBe(true);
    } finally {
      await db
        .update(servers)
        .set({ kind: "docker-engine" })
        .where(eq(servers.id, "srv_foundation_1"));
    }
  });

  it("keeps the build step for direct compose plans that build from remote contexts", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-plan-remote-build",
      session: makeSession("viewer")
    });

    fixtureCounter += 1;
    const suffix = `${Date.now()}_${fixtureCounter}`;
    const stackName = `compose-plan-remote-build-${suffix}`;

    const plan = await caller.composeDeploymentPlan({
      server: "srv_foundation_1",
      compose: [
        `name: ${stackName}`,
        "services:",
        "  web:",
        "    build:",
        "      context: https://github.com/example/web.git#main"
      ].join("\n"),
      composePath: "./fixtures/compose.yaml",
      contextPath: ".",
      localBuildContexts: [],
      requiresContextUpload: false
    });

    expect(plan.isReady).toBe(true);
    expect(plan.steps).toContain("Build staged compose services on foundation-vps-1");
    expect(plan.steps).not.toContain("Pull compose images on foundation-vps-1");
    expect(plan.preflightChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "ok",
          detail:
            "Server-side compose analysis detected 1 compose build service that can build without local upload: web."
        })
      ])
    );
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

  it("omits the build step for direct compose plans that only upload frozen env assets", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-plan-env-upload-only",
      session: makeSession("viewer")
    });

    fixtureCounter += 1;
    const suffix = `${Date.now()}_${fixtureCounter}`;
    const stackName = `compose-env-upload-only-${suffix}`;

    const plan = await caller.composeDeploymentPlan({
      server: "srv_foundation_1",
      compose: [
        `name: ${stackName}`,
        "services:",
        "  api:",
        "    image: example/api:stable",
        "    env_file:",
        "      - ./.runtime.env"
      ].join("\n"),
      composePath: "./fixtures/compose.yaml",
      contextPath: ".",
      localBuildContexts: [],
      requiresContextUpload: true,
      contextBundle: {
        fileCount: 2,
        sizeBytes: 256,
        includedOverrides: [".runtime.env"]
      }
    });

    expect(plan.isReady).toBe(true);
    expect(plan.steps).toContain("Bundle the required local deployment inputs for upload");
    expect(plan.steps).toContain("Run docker compose up -d on foundation-vps-1");
    expect(plan.steps).not.toContain("Build staged compose services on foundation-vps-1");
  });

  it("rejects direct compose plans that omit required context upload for local build inputs", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-plan-missing-upload",
      session: makeSession("viewer")
    });

    const plan = await caller.composeDeploymentPlan({
      server: "srv_foundation_1",
      compose: ["services:", "  web:", "    build:", "      context: ."].join("\n"),
      composePath: "./fixtures/compose.yaml",
      contextPath: ".",
      localBuildContexts: [],
      requiresContextUpload: false
    });

    expect(plan.isReady).toBe(false);
    expect(plan.preflightChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "fail",
          detail:
            "Compose file declares local build inputs, so context upload is required for execution."
        })
      ])
    );
    expect(plan.target).toMatchObject({
      requiresContextUpload: false,
      localBuildContexts: [{ serviceName: "web", context: ".", dockerfile: null }]
    });
  });

  it("rejects direct compose plans that omit upload for local build support files", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-plan-missing-build-support-upload",
      session: makeSession("viewer")
    });

    const plan = await caller.composeDeploymentPlan({
      server: "srv_foundation_1",
      compose: [
        "secrets:",
        "  npm_token:",
        "    file: ./secrets/npm.token",
        "services:",
        "  web:",
        "    build:",
        "      context: https://github.com/example/web.git#main",
        "      additional_contexts:",
        "        local_assets: ./assets",
        "      secrets:",
        "        - source: npm_token"
      ].join("\n"),
      composePath: "./fixtures/compose.yaml",
      contextPath: ".",
      localBuildContexts: [],
      requiresContextUpload: false
    });

    expect(plan.isReady).toBe(false);
    expect(plan.preflightChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "fail",
          detail:
            "Compose file declares local build inputs, so context upload is required for execution."
        }),
        expect.objectContaining({
          status: "ok",
          detail:
            "Server-side compose analysis detected 1 compose build service with local build inputs that require upload: web."
        })
      ])
    );
    expect(plan.target.localBuildContexts).toEqual([]);
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

  it("warns that compose healthcheckPath is legacy metadata and points operators to readiness probes", async () => {
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

      const serviceId = `svclgh${Date.now()}`.slice(0, 32);
      await db.insert(servicesTable).values({
        id: serviceId,
        name: `compose-health-svc-${Date.now()}`,
        slug: `compose-health-svc-${Date.now()}`.slice(0, 40),
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        targetServerId: "srv_foundation_1",
        healthcheckPath: "/ready",
        status: "inactive",
        config: {},
        updatedAt: new Date()
      });

      const plan = await caller.deploymentPlan({
        service: serviceId
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
            check.detail.includes(
              'healthcheckPath "/ready" is legacy metadata only and is not executed'
            )
        )
      ).toBe(true);
    } finally {
      repository.cleanup();
    }
  });

  it("keeps interpolation diagnostics for non-repo compose plans with replayable source", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-compose-replayable-non-repo",
      session: makeSession("viewer")
    });

    fixtureCounter += 1;
    const suffix = `${Date.now()}_${fixtureCounter}`;
    const projectName = `compose-replayable-plan-${suffix}`;
    const environmentName = `compose-replayable-env-${suffix}`;
    const serviceName = `compose-replayable-svc-${suffix}`;

    const projectResult = await createProject({
      name: projectName,
      description: "Replayable non-repo compose planning fixture",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create replayable non-repo planning fixture project.");
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
      throw new Error("Failed to create replayable non-repo planning fixture environment.");
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
      throw new Error("Failed to create replayable non-repo planning fixture service.");
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

    const deploymentId = `replayplan_${suffix}`.slice(0, 32);
    const createdAt = new Date(Date.now() - 60_000);

    await db.insert(deployments).values({
      id: deploymentId,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName,
      sourceType: "compose",
      commitSha: "abcd1234",
      imageTag: "ghcr.io/daoflow/replayable:stable",
      configSnapshot: {
        projectName,
        environmentName,
        targetServerName: "foundation-vps-1",
        targetServerHost: "203.0.113.24"
      },
      envVarsEncrypted: encryptComposeDeploymentState({
        envEntries: [
          {
            key: "DATABASE_URL",
            value: "postgres://fixture",
            category: "runtime",
            isSecret: true,
            source: "inline",
            branchPattern: "main"
          }
        ],
        frozenInputs: {
          composeFile: {
            path: ".daoflow.compose.rendered.yaml",
            sourcePath: "compose.yaml",
            contents: [
              "services:",
              "  api:",
              "    image: example/api:stable",
              "    environment:",
              "      DATABASE_URL: ${DATABASE_URL?required}"
            ].join("\n")
          },
          envFiles: []
        }
      }),
      status: "completed",
      conclusion: "succeeded",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      createdAt,
      concludedAt: createdAt,
      updatedAt: createdAt
    });

    const plan = await caller.deploymentPlan({
      service: serviceResult.service.id
    });

    expect(plan.isReady).toBe(true);
    expect(plan.composeEnvPlan).not.toBeNull();
    expect(plan.composeEnvPlan?.interpolation.summary).toMatchObject({
      totalReferences: 1,
      unresolved: 0,
      requiredMissing: 0,
      optionalMissing: 0
    });
    expect(plan.composeEnvPlan?.interpolation.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "DATABASE_URL",
          expression: "${DATABASE_URL?required}"
        })
      ])
    );
    expect(
      plan.preflightChecks.some(
        (check) =>
          check.status === "warn" && check.detail.includes("interpolation analysis is unavailable")
      )
    ).toBe(false);
  });

  it("models explicit compose readiness probes in the deployment plan", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-compose-readiness-probe",
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
        name: `compose-readiness-plan-${Date.now()}`,
        repoUrl: repository.rootDir,
        composePath: "deploy/compose.yaml",
        defaultBranch: "main",
        teamId: "team_foundation",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (projectResult.status !== "ok") {
        throw new Error("Failed to create compose readiness planning fixture project.");
      }

      const environmentResult = await createEnvironment({
        projectId: projectResult.project.id,
        name: `compose-readiness-env-${Date.now()}`,
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (environmentResult.status !== "ok") {
        throw new Error("Failed to create compose readiness planning fixture environment.");
      }

      const serviceResult = await createService({
        name: `compose-readiness-svc-${Date.now()}`,
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        composeServiceName: "api",
        targetServerId: "srv_foundation_1",
        healthcheckPath: "/legacy-ready",
        readinessProbe: {
          type: "http",
          target: "published-port",
          port: 8080,
          path: "/ready"
        },
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (serviceResult.status !== "ok") {
        throw new Error("Failed to create compose readiness planning fixture service.");
      }

      const plan = await caller.deploymentPlan({
        service: serviceResult.service.id
      });

      expect(plan.isReady).toBe(true);
      expect(plan.service.readinessProbe).toMatchObject({
        type: "http",
        target: "published-port",
        host: "127.0.0.1",
        port: 8080,
        path: "/ready",
        scheme: "http",
        timeoutSeconds: 60,
        intervalSeconds: 3,
        successStatusCodes: [200]
      });
      expect(plan.steps).toContain(
        "Verify Docker Compose container state, Docker health, and HTTP readiness on published endpoint http://127.0.0.1:8080/ready expecting 200 within 60s (poll every 3s), then mark the rollout outcome"
      );
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "ok" &&
            check.detail.includes(
              "Compose execution will run HTTP readiness on published endpoint http://127.0.0.1:8080/ready expecting 200 within 60s"
            )
        )
      ).toBe(true);
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "warn" &&
            check.detail.includes(
              'Legacy healthcheckPath "/legacy-ready" remains stored for compatibility'
            )
        )
      ).toBe(true);
      expect(
        plan.preflightChecks.some(
          (check) => check.status === "warn" && check.detail.includes("advisory only today")
        )
      ).toBe(false);
    } finally {
      repository.cleanup();
    }
  });

  it("models internal-network TCP readiness probes in the deployment plan", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-compose-tcp-readiness-probe",
      session: makeSession("viewer")
    });
    const repository = createLocalGitRepository({
      files: {
        "deploy/compose.yaml": "services:\n  db:\n    image: postgres:16\n"
      }
    });

    try {
      const projectResult = await createProject({
        name: `compose-tcp-readiness-plan-${Date.now()}`,
        repoUrl: repository.rootDir,
        composePath: "deploy/compose.yaml",
        defaultBranch: "main",
        teamId: "team_foundation",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (projectResult.status !== "ok") {
        throw new Error("Failed to create TCP readiness planning fixture project.");
      }

      const environmentResult = await createEnvironment({
        projectId: projectResult.project.id,
        name: `compose-tcp-readiness-env-${Date.now()}`,
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (environmentResult.status !== "ok") {
        throw new Error("Failed to create TCP readiness planning fixture environment.");
      }

      const serviceResult = await createService({
        name: `compose-tcp-readiness-svc-${Date.now()}`,
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        composeServiceName: "db",
        targetServerId: "srv_foundation_1",
        readinessProbe: {
          type: "tcp",
          target: "internal-network",
          port: 5432
        },
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (serviceResult.status !== "ok") {
        throw new Error("Failed to create TCP readiness planning fixture service.");
      }

      const plan = await caller.deploymentPlan({
        service: serviceResult.service.id
      });

      expect(plan.isReady).toBe(true);
      expect(plan.service.readinessProbe).toMatchObject({
        type: "tcp",
        target: "internal-network",
        port: 5432,
        timeoutSeconds: 60,
        intervalSeconds: 3
      });
      expect(plan.steps).toContain(
        "Verify Docker Compose container state, Docker health, and TCP readiness on compose internal network tcp://db:5432 within 60s (poll every 3s), then mark the rollout outcome"
      );
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "ok" &&
            check.detail.includes(
              "Compose execution will run TCP readiness on compose internal network tcp://db:5432 within 60s"
            )
        )
      ).toBe(true);
    } finally {
      repository.cleanup();
    }
  });

  it("allows internal-network TCP readiness probes on swarm manager deployment plans", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-swarm-tcp-readiness-probe",
      session: makeSession("viewer")
    });
    const repository = createLocalGitRepository({
      files: {
        "deploy/compose.yaml": "services:\n  db:\n    image: postgres:16\n"
      }
    });

    await caller.services({});
    await db
      .update(servers)
      .set({ kind: "docker-swarm-manager" })
      .where(eq(servers.id, "srv_foundation_1"));

    try {
      const projectResult = await createProject({
        name: `swarm-tcp-readiness-plan-${Date.now()}`,
        repoUrl: repository.rootDir,
        composePath: "deploy/compose.yaml",
        defaultBranch: "main",
        teamId: "team_foundation",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (projectResult.status !== "ok") {
        throw new Error("Failed to create Swarm TCP readiness planning fixture project.");
      }

      const environmentResult = await createEnvironment({
        projectId: projectResult.project.id,
        name: `swarm-tcp-readiness-env-${Date.now()}`,
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (environmentResult.status !== "ok") {
        throw new Error("Failed to create Swarm TCP readiness planning fixture environment.");
      }

      const serviceResult = await createService({
        name: `swarm-tcp-readiness-svc-${Date.now()}`,
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        composeServiceName: "db",
        targetServerId: "srv_foundation_1",
        readinessProbe: {
          type: "tcp",
          target: "internal-network",
          port: 5432
        },
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (serviceResult.status !== "ok") {
        throw new Error("Failed to create Swarm TCP readiness planning fixture service.");
      }

      const plan = await caller.deploymentPlan({
        service: serviceResult.service.id
      });

      expect(plan.isReady).toBe(true);
      expect(plan.target.targetKind).toBe("docker-swarm-manager");
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "ok" &&
            check.detail.includes(
              "Swarm execution will run TCP readiness on compose internal network tcp://db:5432 within 60s"
            )
        )
      ).toBe(true);
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "fail" &&
            check.detail.includes("supports published-port readiness probes only")
        )
      ).toBe(false);
    } finally {
      await db
        .update(servers)
        .set({ kind: "docker-engine" })
        .where(eq(servers.id, "srv_foundation_1"));
      repository.cleanup();
    }
  });

  it("models compose preview stack and env overlays in the deployment plan", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-compose-preview",
      session: makeSession("viewer")
    });
    const repository = createLocalGitRepository({
      branch: "feature/login",
      files: {
        "deploy/compose.yaml": "services:\n  web:\n    image: nginx:alpine\n"
      }
    });

    try {
      const projectResult = await createProject({
        name: `compose-preview-plan-${Date.now()}`,
        repoUrl: repository.rootDir,
        composePath: "deploy/compose.yaml",
        defaultBranch: "feature/login",
        teamId: "team_foundation",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (projectResult.status !== "ok") {
        throw new Error("Failed to create preview planning fixture project.");
      }

      const environmentResult = await createEnvironment({
        projectId: projectResult.project.id,
        name: `compose-preview-env-${Date.now()}`,
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (environmentResult.status !== "ok") {
        throw new Error("Failed to create preview planning fixture environment.");
      }

      const serviceResult = await createService({
        name: `compose-preview-svc-${Date.now()}`,
        projectId: projectResult.project.id,
        environmentId: environmentResult.environment.id,
        sourceType: "compose",
        preview: {
          enabled: true,
          mode: "pull-request",
          domainTemplate: "preview-{pr}.example.test"
        },
        targetServerId: "srv_foundation_1",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner"
      });
      if (serviceResult.status !== "ok") {
        throw new Error("Failed to create preview planning fixture service.");
      }

      await db.insert(environmentVariables).values({
        environmentId: environmentResult.environment.id,
        key: "PREVIEW_FLAG",
        valueEncrypted: encrypt("enabled"),
        isSecret: "false",
        category: "runtime",
        source: "inline",
        branchPattern: "preview/*"
      });

      const plan = await caller.deploymentPlan({
        service: serviceResult.service.id,
        preview: {
          target: "pull-request",
          branch: "feature/login",
          pullRequestNumber: 42
        }
      });

      expect(plan.isReady).toBe(true);
      expect(plan.composeEnvPlan?.branch).toBe("preview/pr-42");
      expect(plan.target.preview).toMatchObject({
        target: "pull-request",
        branch: "feature/login",
        envBranch: "preview/pr-42",
        primaryDomain: "preview-42.example.test"
      });
      expect(
        plan.preflightChecks.some(
          (check) => check.status === "ok" && check.detail.includes("isolated stack")
        )
      ).toBe(true);
      expect(
        plan.preflightChecks.some(
          (check) =>
            check.status === "ok" &&
            check.detail === "Preview domain mapping resolves to preview-42.example.test."
        )
      ).toBe(true);
      expect(plan.executeCommand).toContain("--preview-branch feature/login");
      expect(plan.executeCommand).toContain("--preview-pr 42");
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
  }, 10_000);

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
  }, 10_000);

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
