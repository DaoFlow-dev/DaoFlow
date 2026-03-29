import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/connection";
import { deployments } from "./db/schema/deployments";
import { approvalRequests, auditEntries } from "./db/schema/audit";
import { backupPolicies, backupRestores, volumes } from "./db/schema/storage";
import { notificationLogs } from "./db/schema/notifications";
import { servers } from "./db/schema/servers";
import { teamMembers, teams } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { createEnvironment, createProject } from "./db/services/projects";
import { asRecord } from "./db/services/json-helpers";
import { createService } from "./db/services/services";
import { upsertEnvironmentVariable } from "./db/services/envvars";
import type { ComposeReadinessProbeInput } from "./compose-readiness";
import { extractReplayableConfigSnapshot } from "./db/services/deployment-source";
import { appRouter } from "./router";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import {
  createProjectEnvironmentServiceFixture,
  foundationOwnerRequester
} from "./testing/project-fixtures";
import {
  makeCustomSession,
  makeSession,
  makeTokenAuthContext
} from "./testing/request-auth-fixtures";

let rollbackFixtureCounter = 0;
let otherTeamFixtureCounter = 0;

async function createRollbackFixture(input: { readinessProbe?: ComposeReadinessProbeInput } = {}) {
  rollbackFixtureCounter += 1;
  const suffix = `${Date.now()}_${rollbackFixtureCounter}`;
  const projectName = `rollback-fixture-${suffix}`;
  const environmentName = `preview-${suffix}`;
  const serviceName = `svc-${suffix}`;

  const fixture = await createProjectEnvironmentServiceFixture({
    project: {
      name: projectName,
      description: "Rollback planning fixture",
      teamId: "team_foundation"
    },
    environment: {
      name: environmentName,
      targetServerId: "srv_foundation_1"
    },
    service: {
      name: serviceName,
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      readinessProbe: input.readinessProbe
    }
  });

  const successDeploymentId = `depok_${suffix}`.slice(0, 32);
  const failedDeploymentId = `depfail_${suffix}`.slice(0, 32);
  const successCreatedAt = new Date(Date.now() - 5 * 60 * 1000);
  const failedCreatedAt = new Date(Date.now() - 60 * 1000);

  await db.insert(deployments).values([
    {
      id: successDeploymentId,
      projectId: fixture.project.id,
      environmentId: fixture.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName,
      sourceType: "compose",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/fixture:stable",
      configSnapshot: {
        projectName,
        environmentName,
        targetServerName: "foundation-vps-1",
        targetServerHost: "203.0.113.24"
      },
      status: "completed",
      conclusion: "succeeded",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      createdAt: successCreatedAt,
      concludedAt: new Date(successCreatedAt.getTime() + 30_000),
      updatedAt: new Date(successCreatedAt.getTime() + 30_000)
    },
    {
      id: failedDeploymentId,
      projectId: fixture.project.id,
      environmentId: fixture.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName,
      sourceType: "compose",
      commitSha: "abcdef2",
      imageTag: "ghcr.io/daoflow/fixture:broken",
      configSnapshot: {
        projectName,
        environmentName,
        targetServerName: "foundation-vps-1",
        targetServerHost: "203.0.113.24"
      },
      status: "failed",
      conclusion: "failed",
      trigger: "user",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner",
      error: { message: "Fixture failure" },
      createdAt: failedCreatedAt,
      concludedAt: new Date(failedCreatedAt.getTime() + 20_000),
      updatedAt: new Date(failedCreatedAt.getTime() + 20_000)
    }
  ]);

  return {
    serviceId: fixture.service.id,
    successDeploymentId,
    failedDeploymentId
  };
}

async function createOtherTeamFixture() {
  otherTeamFixtureCounter += 1;
  const suffix = `${Date.now().toString(36)}_${otherTeamFixtureCounter}`;
  const teamId = `team_other_${suffix}`.slice(0, 32);
  const userId = `user_other_${suffix}`.slice(0, 32);
  const projectName = `other-team-project-${suffix}`;
  const environmentName = `other-team-env-${suffix}`;

  await db.insert(users).values({
    id: userId,
    email: `${userId}@daoflow.local`,
    name: `Other Team Admin ${suffix}`,
    username: userId,
    emailVerified: true,
    role: "admin",
    status: "active",
    defaultTeamId: teamId,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await db.insert(teams).values({
    id: teamId,
    name: `Other Team ${suffix}`,
    slug: `other-team-${suffix}`.slice(0, 40),
    status: "active",
    createdByUserId: userId,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await db.insert(teamMembers).values({
    id: Math.floor(Math.random() * 1_000_000_000),
    teamId,
    userId,
    role: "owner",
    createdAt: new Date()
  });

  const fixture = await createProjectEnvironmentServiceFixture({
    project: {
      name: projectName,
      description: "Cross-team access fixture",
      teamId
    },
    environment: {
      teamId,
      name: environmentName,
      targetServerId: "srv_foundation_1"
    },
    requester: {
      ...foundationOwnerRequester,
      requestedByUserId: userId,
      requestedByEmail: `${userId}@daoflow.local`,
      requestedByRole: "owner"
    }
  });

  return {
    teamId,
    userId,
    projectId: fixture.project.id,
    environmentId: fixture.environment.id
  };
}

describe("appRouter", () => {
  beforeEach(async () => {
    rollbackFixtureCounter = 0;
    otherTeamFixtureCounter = 0;
    await resetTestDatabaseWithControlPlane();
  });

  it("returns a healthy status payload", async () => {
    const caller = appRouter.createCaller({ requestId: "test-health", session: null });
    const response = await caller.health();

    expect(response.status).toBe("healthy");
    expect(response.service).toBe("daoflow-control-plane");
  });

  it("rejects protected procedures without a session", async () => {
    const caller = appRouter.createCaller({ requestId: "test-protected", session: null });

    await expect(caller.recentDeployments({})).rejects.toMatchObject({
      code: "UNAUTHORIZED"
    } satisfies Partial<TRPCError>);
  });

  it("propagates structured token auth failures through protected procedures", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-protected-expired-token",
      session: null,
      authFailure: {
        status: 401,
        body: {
          ok: false,
          error: "API token has expired.",
          code: "TOKEN_EXPIRED"
        }
      }
    });

    await expect(caller.recentDeployments({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "API token has expired.",
      cause: {
        ok: false,
        error: "API token has expired.",
        code: "TOKEN_EXPIRED"
      }
    });
  });

  it("filters roadmap items by lane", async () => {
    const caller = appRouter.createCaller({ requestId: "test-roadmap", session: null });
    const response = await caller.roadmap({ lane: "agent-safety" });

    expect(response).toHaveLength(1);
    expect(response[0]?.lane).toBe("agent-safety");
  });

  it("returns viewer authz details for signed-in users", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-viewer",
      session: makeSession("viewer")
    });
    const response = await caller.viewer();

    expect(response.authz.role).toBe("viewer");
    expect(response.authz.capabilities).toContain("server:read");
  });

  it("returns token-backed identity details for bearer-auth callers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-viewer-token",
      session: makeSession("agent"),
      auth: makeTokenAuthContext("agent", ["server:read", "deploy:read"], "agent")
    });

    const response = await caller.viewer();

    expect(response.principal.type).toBe("agent");
    expect(response.authz.authMethod).toBe("api-token");
    expect(response.authz.capabilities).toEqual(["server:read", "deploy:read"]);
    expect(response.session).toBeNull();
  });

  it("denies command procedures when a token scopes an owner down to read-only", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-owner-token-scope",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["deploy:read"])
    });

    await expect(
      caller.registerServer({
        name: "scoped-owner",
        host: "203.0.113.55",
        sshUser: "root",
        sshPort: 22,
        region: "local-test",
        kind: "docker-engine"
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: {
        code: "SCOPE_DENIED",
        requiredScopes: ["server:write"],
        grantedScopes: ["deploy:read"]
      }
    });
  });

  it("returns deployment records without inline step expansion", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-deployments",
      session: makeSession("viewer")
    });
    const response = await caller.recentDeployments({});

    expect(Array.isArray(response)).toBe(true);

    const deployment = response[0];
    if (!deployment) {
      return;
    }

    expect(deployment.statusTone).toEqual(expect.any(String));
    expect(deployment.statusLabel).toEqual(expect.any(String));
    expect(deployment.projectId).toEqual(expect.any(String));
    expect(deployment.projectName).toEqual(expect.any(String));
    expect(deployment.serviceId === null || typeof deployment.serviceId === "string").toBe(true);
    expect(deployment.healthSummary).toBeTruthy();
    expect(deployment.healthSummary?.status).toEqual(expect.any(String));
    expect(deployment.healthSummary?.statusLabel).toEqual(expect.any(String));
    expect(deployment.healthSummary?.statusTone).toEqual(expect.any(String));
    expect(deployment.healthSummary?.summary).toEqual(expect.any(String));
    expect(deployment.rolloutStrategy).toBeTruthy();
    expect(deployment.rolloutStrategy?.key).toEqual(expect.any(String));
    expect(deployment.rolloutStrategy?.label).toEqual(expect.any(String));
    expect(deployment.rolloutStrategy?.downtimeRisk).toEqual(expect.any(String));
    expect(deployment.rolloutStrategy?.supportsZeroDowntime).toEqual(expect.any(Boolean));
    expect(Array.isArray(deployment.steps)).toBe(true);
    expect(
      deployment.executionEngine === "legacy" || deployment.executionEngine === "temporal"
    ).toBe(true);

    const details = await caller.deploymentDetails({
      deploymentId: deployment.id
    });

    expect(details.id).toBe(deployment.id);
    expect(Array.isArray(details.steps)).toBe(true);
    expect(details.executionEngine === "legacy" || details.executionEngine === "temporal").toBe(
      true
    );
    expect(details.stateArtifacts).toBeTruthy();
    expect(details.stateArtifacts.declaredConfig.sourceType).toBe(details.sourceType);
    expect(details.stateArtifacts.effectiveDeployment.replayableSnapshot).toEqual(
      extractReplayableConfigSnapshot(asRecord(details.configSnapshot))
    );

    const guidedDeployment = response.find((item) => item.recoveryGuidance);
    expect(guidedDeployment?.recoveryGuidance?.summary).toEqual(expect.any(String));
    expect(Array.isArray(guidedDeployment?.recoveryGuidance?.safeActions)).toBe(true);
  });

  it("returns current compose release catalog and drift report shapes", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose",
      session: makeSession("viewer")
    });

    const catalog = await caller.composeReleaseCatalog({});
    const drift = await caller.composeDriftReport({});

    expect(catalog.summary.totalServices).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(catalog.services)).toBe(true);

    const service = catalog.services[0];
    if (service) {
      expect(service.environmentId).toEqual(expect.any(String));
      expect(service.targetServerId).toEqual(expect.any(String));
      expect(service.projectName).toEqual(expect.any(String));
      expect(service.releaseTrackTone).toEqual(expect.any(String));
      expect(service.releaseTrackLabel).toEqual(expect.any(String));
    }

    expect(drift.summary.totalServices).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(drift.reports)).toBe(true);

    const report = drift.reports[0];
    if (report) {
      expect(report.statusTone).toEqual(expect.any(String));
      expect(report.statusLabel).toEqual(expect.any(String));
    }
  });

  it("queues compose releases with service-scoped image override metadata", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-release-queue",
      session: makeSession("developer")
    });
    const catalog = await caller.composeReleaseCatalog({});
    const service = catalog.services.find((candidate) => candidate.imageReference.length > 0);

    if (!service) {
      return;
    }

    const deployment = await caller.queueComposeRelease({
      composeServiceId: service.id,
      commitSha: "abcdef1",
      imageTag: `${service.imageReference}-override`
    });

    expect(deployment.imageTag).toBe(`${service.imageReference}-override`);
    expect(asRecord(deployment.configSnapshot)).toMatchObject({
      composeServiceName: service.serviceName,
      composeImageOverride: {
        serviceName: service.serviceName,
        imageReference: `${service.imageReference}-override`
      }
    });
  });

  it("returns deployment rollback plans with normalized status metadata", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-deployment-rollback-plans",
      session: makeSession("viewer")
    });

    const plans = await caller.deploymentRollbackPlans({});

    expect(Array.isArray(plans)).toBe(true);

    const plan = plans[0];
    if (!plan) {
      return;
    }

    expect(plan.planStatusTone).toEqual(expect.any(String));
    expect(plan.planStatusLabel).toEqual(expect.any(String));
    expect(plan.currentStatusTone).toEqual(expect.any(String));
    expect(plan.currentStatusLabel).toEqual(expect.any(String));
  });

  it("returns deployment insights with normalized status metadata", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-deployment-insights",
      session: makeSession("viewer")
    });

    const insights = await caller.deploymentInsights({});

    expect(Array.isArray(insights)).toBe(true);

    const insight = insights[0];
    if (!insight) {
      return;
    }

    expect(insight.statusTone).toEqual(expect.any(String));
    expect(insight.statusLabel).toEqual(expect.any(String));
  });

  it("returns normalized compose readiness probe metadata from service reads", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-service-readiness-probe",
      session: makeSession("viewer")
    });

    const projectResult = await createProject({
      name: `service-readiness-${Date.now()}`,
      description: "Compose readiness read fixture",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create service readiness project fixture.");
    }

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: `service-readiness-env-${Date.now()}`,
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(environmentResult.status).toBe("ok");
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create service readiness environment fixture.");
    }

    const serviceResult = await createService({
      name: `service-readiness-svc-${Date.now()}`,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      composeServiceName: "api",
      targetServerId: "srv_foundation_1",
      preview: {
        enabled: true,
        mode: "pull-request",
        domainTemplate: "api-pr-{pr}.preview.example.com"
      },
      readinessProbe: {
        type: "http",
        target: "published-port",
        port: 3000,
        path: "/ready",
        successStatusCodes: [200, 204]
      },
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create service readiness service fixture.");
    }

    const [serviceDetails, listedServices] = await Promise.all([
      caller.serviceDetails({ serviceId: serviceResult.service.id }),
      caller.services({ environmentId: environmentResult.environment.id })
    ]);

    expect(asRecord(serviceDetails.config).readinessProbe).toMatchObject({
      type: "http",
      target: "published-port",
      host: "127.0.0.1",
      scheme: "http",
      port: 3000,
      path: "/ready",
      timeoutSeconds: 60,
      intervalSeconds: 3,
      successStatusCodes: [200, 204]
    });
    expect(asRecord(serviceDetails.config).preview).toMatchObject({
      enabled: true,
      mode: "pull-request",
      domainTemplate: "api-pr-{pr}.preview.example.com"
    });
    expect(serviceDetails.runtimeSummary).toBeTruthy();
    expect(serviceDetails.runtimeSummary?.status).toEqual(expect.any(String));
    expect(serviceDetails.runtimeSummary?.statusLabel).toEqual(expect.any(String));
    expect(serviceDetails.runtimeSummary?.statusTone).toEqual(expect.any(String));
    expect(serviceDetails.runtimeSummary?.summary).toEqual(expect.any(String));
    expect(serviceDetails.rolloutStrategy).toBeTruthy();
    expect(serviceDetails.rolloutStrategy?.key).toBe("compose-recreate");
    expect(serviceDetails.rolloutStrategy?.label).toEqual(expect.any(String));
    expect(serviceDetails.rolloutStrategy?.supportsZeroDowntime).toBe(false);
    expect(
      listedServices.some(
        (service) =>
          service.id === serviceResult.service.id &&
          service.runtimeSummary &&
          service.rolloutStrategy &&
          asRecord(service.config).readinessProbe &&
          asRecord(service.config).readinessProbe !== null
      )
    ).toBe(true);
  });

  it("persists DaoFlow-managed runtime overrides for compose services", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-runtime-overrides",
      session: makeSession("owner")
    });

    const projectResult = await createProject({
      name: `service-runtime-project-${Date.now()}`,
      description: "Runtime override fixture",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create runtime override project fixture.");
    }

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: `runtime-overrides-env-${Date.now()}`,
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(environmentResult.status).toBe("ok");
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create runtime override environment fixture.");
    }

    const serviceResult = await createService({
      name: `runtime-overrides-svc-${Date.now()}`,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      sourceType: "compose",
      composeServiceName: "api",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(serviceResult.status).toBe("ok");
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create runtime override service fixture.");
    }

    const updated = await caller.updateServiceRuntimeConfig({
      serviceId: serviceResult.service.id,
      volumes: [
        {
          source: "/srv/data",
          target: "/var/lib/postgresql/data",
          mode: "rw"
        }
      ],
      networks: ["public"],
      restartPolicy: {
        name: "on-failure",
        maxRetries: 5
      }
    });

    expect(updated.runtimeConfig).toMatchObject({
      volumes: [
        {
          source: "/srv/data",
          target: "/var/lib/postgresql/data",
          mode: "rw"
        }
      ],
      networks: ["public"],
      restartPolicy: {
        name: "on-failure",
        maxRetries: 5
      }
    });
    expect(updated.runtimeConfigPreview).toContain("restart: on-failure:5");

    const details = await caller.serviceDetails({ serviceId: serviceResult.service.id });
    expect(asRecord(details.config).runtimeConfig).toMatchObject({
      networks: ["public"]
    });
    expect(details.runtimeConfigPreview).toContain("services:");
  });

  it("returns a real deployment plan from the planning lane", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan",
      session: makeSession("viewer")
    });

    const services = await caller.services({});
    const service = services.find((candidate) => candidate.sourceType === "compose") ?? services[0];

    if (!service) {
      return;
    }

    const plan = await caller.deploymentPlan({
      service: service.id
    });

    expect(plan.service.id).toBe(service.id);
    expect(plan.service.projectName).toEqual(expect.any(String));
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.preflightChecks)).toBe(true);
    expect(plan.executeCommand).toContain("daoflow deploy");
    if (plan.service.sourceType === "compose") {
      expect(plan.composeEnvPlan).toBeTruthy();
      expect(plan.composeEnvPlan?.branch).toEqual(expect.any(String));
      if (plan.service.composeServiceName) {
        expect(plan.steps).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`compose service ${plan.service.composeServiceName}`),
            expect.stringContaining(`docker compose up -d ${plan.service.composeServiceName}`)
          ])
        );
      }
    }
  });

  it("returns Swarm-specific deployment and rollback plans for swarm manager targets", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-swarm",
      session: makeSession("viewer")
    });

    // Force the lazy foundation seed to materialize before mutating the shared server row.
    await caller.services({});

    await db
      .update(servers)
      .set({ kind: "docker-swarm-manager" })
      .where(eq(servers.id, "srv_foundation_1"));

    try {
      const fixture = await createRollbackFixture({
        readinessProbe: {
          type: "tcp",
          target: "internal-network",
          port: 5432
        }
      });

      const deploymentPlan = await caller.deploymentPlan({
        service: fixture.serviceId
      });
      expect(deploymentPlan.target.targetKind).toBe("docker-swarm-manager");
      expect(deploymentPlan.steps).toEqual(
        expect.arrayContaining([expect.stringContaining("docker stack deploy")])
      );

      const rollbackPlan = await caller.rollbackPlan({
        service: fixture.serviceId,
        target: fixture.successDeploymentId
      });
      expect(rollbackPlan.isReady).toBe(true);
      expect(rollbackPlan.steps).toEqual(
        expect.arrayContaining([expect.stringContaining("docker stack deploy semantics")])
      );
      expect(
        rollbackPlan.preflightChecks.some(
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
    }
  });

  it("rejects planning requests that override the configured target server", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan-server-mismatch",
      session: makeSession("viewer")
    });

    const [serviceList, inventory] = await Promise.all([
      caller.services({}),
      caller.infrastructureInventory()
    ]);
    const targetableService = serviceList.find(
      (service) => typeof service.targetServerId === "string" && service.targetServerId.length > 0
    );

    if (!targetableService) {
      return;
    }

    const otherServer = inventory.servers.find(
      (server) => server.id !== targetableService.targetServerId
    );
    if (!otherServer) {
      return;
    }

    await expect(
      caller.deploymentPlan({
        service: targetableService.id,
        server: otherServer.id
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });

  it("returns a real rollback plan from the planning lane", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-rollback-plan",
      session: makeSession("viewer")
    });
    const fixture = await createRollbackFixture();

    const plan = await caller.rollbackPlan({
      service: fixture.serviceId,
      target: fixture.successDeploymentId
    });

    expect(plan.service.id).toBe(fixture.serviceId);
    expect(plan.targetDeployment?.id).toBe(fixture.successDeploymentId);
    expect(Array.isArray(plan.availableTargets)).toBe(true);
    expect(Array.isArray(plan.preflightChecks)).toBe(true);
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.executeCommand).toContain("daoflow rollback");
  });

  it("rejects rollback planning targets that are outside the scoped success window", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-rollback-plan-invalid-target",
      session: makeSession("viewer")
    });
    const fixture = await createRollbackFixture();

    await expect(
      caller.rollbackPlan({
        service: fixture.serviceId,
        target: fixture.failedDeploymentId
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });

  it("returns deployment logs keyed by level and supports targeted filters", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-logs",
      session: makeSession("viewer")
    });
    const response = await caller.deploymentLogs({
      deploymentId: "dep_foundation_20260311_1",
      query: "readiness",
      stream: "stderr"
    });

    expect(response.summary.totalLines).toBeGreaterThanOrEqual(0);
    expect(response.lines.length).toBeGreaterThan(0);

    const line = response.lines[0];
    if (!line) {
      return;
    }

    expect(line.deploymentId).toBe("dep_foundation_20260311_1");
    expect(line.stream).toBe("stderr");
    expect(line.message.toLowerCase()).toContain("readiness");
    expect(line.level).toEqual(expect.any(String));
    expect(line.stream).toEqual(expect.any(String));
  });

  it("returns audit entries keyed by targetResource", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-audit",
      session: makeSession("viewer")
    });
    const response = await caller.auditTrail({});

    expect(response.summary.totalEntries).toBeGreaterThanOrEqual(0);

    const entry = response.entries[0];
    if (!entry) {
      return;
    }

    expect(entry.targetResource).toEqual(expect.any(String));
    expect(entry.resourceType).toEqual(expect.any(String));
    expect(entry.resourceId).toEqual(expect.any(String));
    expect(entry.statusTone).toEqual(expect.any(String));
  });

  it("filters audit entries to the requested recent window", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-audit-since",
      session: makeSession("viewer")
    });
    const suffix = Date.now().toString(36);
    const recentTarget = `audit-test/recent-${suffix}`;
    const oldTarget = `audit-test/old-${suffix}`;

    await db.insert(auditEntries).values([
      {
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        organizationId: "team_foundation",
        targetResource: recentTarget,
        action: "deployment.created",
        inputSummary: "Recent audit fixture",
        permissionScope: "deploy:start",
        outcome: "success",
        metadata: {
          resourceType: "audit-test",
          resourceId: `recent-${suffix}`,
          resourceLabel: recentTarget,
          detail: "Recent audit fixture"
        },
        createdAt: new Date(Date.now() - 30 * 60_000)
      },
      {
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        organizationId: "team_foundation",
        targetResource: oldTarget,
        action: "deployment.created",
        inputSummary: "Old audit fixture",
        permissionScope: "deploy:start",
        outcome: "success",
        metadata: {
          resourceType: "audit-test",
          resourceId: `old-${suffix}`,
          resourceLabel: oldTarget,
          detail: "Old audit fixture"
        },
        createdAt: new Date(Date.now() - 2 * 60 * 60_000)
      }
    ]);

    const response = await caller.auditTrail({ limit: 50, since: "1h" });

    expect(response.entries.some((entry) => entry.targetResource === recentTarget)).toBe(true);
    expect(response.entries.some((entry) => entry.targetResource === oldTarget)).toBe(false);
  });

  it("returns summary counts for the full filtered set instead of only the current page", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-audit-summary-scope",
      session: makeSession("viewer")
    });
    const suffix = Date.now().toString(36);

    await db.delete(auditEntries);
    await db.insert(auditEntries).values([
      {
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        organizationId: "team_foundation",
        targetResource: `audit-test/deploy-a-${suffix}`,
        action: "deployment.created",
        inputSummary: "Deployment fixture A",
        permissionScope: "deploy:start",
        outcome: "success",
        metadata: { detail: "Deployment fixture A" },
        createdAt: new Date(Date.now() - 10 * 60_000)
      },
      {
        actorType: "agent",
        actorId: "agent_fixture",
        actorEmail: null,
        actorRole: "operator",
        organizationId: "team_foundation",
        targetResource: `audit-test/exec-${suffix}`,
        action: "execution.dispatch",
        inputSummary: "Execution fixture",
        permissionScope: "deploy:start",
        outcome: "success",
        metadata: { detail: "Execution fixture" },
        createdAt: new Date(Date.now() - 9 * 60_000)
      },
      {
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        organizationId: "team_foundation",
        targetResource: `audit-test/backup-${suffix}`,
        action: "backup.started",
        inputSummary: "Backup fixture",
        permissionScope: "backup:run",
        outcome: "success",
        metadata: { detail: "Backup fixture" },
        createdAt: new Date(Date.now() - 8 * 60_000)
      },
      {
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        organizationId: "team_foundation",
        targetResource: `audit-test/deploy-b-${suffix}`,
        action: "deployment.created",
        inputSummary: "Deployment fixture B",
        permissionScope: "deploy:start",
        outcome: "success",
        metadata: { detail: "Deployment fixture B" },
        createdAt: new Date(Date.now() - 7 * 60_000)
      },
      {
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        organizationId: "team_foundation",
        targetResource: `audit-test/old-${suffix}`,
        action: "deployment.created",
        inputSummary: "Old fixture",
        permissionScope: "deploy:start",
        outcome: "success",
        metadata: { detail: "Old fixture" },
        createdAt: new Date(Date.now() - 2 * 60 * 60_000)
      }
    ]);

    const response = await caller.auditTrail({ limit: 1, since: "1h" });

    expect(response.entries).toHaveLength(1);
    expect(response.summary).toEqual({
      totalEntries: 4,
      deploymentActions: 2,
      executionActions: 1,
      backupActions: 1,
      humanEntries: 3
    });
  });

  it("returns environment variable inventory and redacted values", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-envvars",
      session: makeSession("viewer")
    });
    const response = await caller.environmentVariables({});

    expect(response.summary.totalVariables).toBeGreaterThanOrEqual(0);

    const variable = response.variables[0];
    if (!variable) {
      return;
    }

    expect(variable.environmentId).toEqual(expect.any(String));
    expect(variable.displayValue).toEqual(expect.any(String));
  });

  it("requires env:read and reveals secrets only when explicitly authorized", async () => {
    const key = `TEST_ENV_SCOPE_${Date.now().toString(36).toUpperCase()}`;
    await upsertEnvironmentVariable({
      environmentId: "env_daoflow_staging",
      key,
      value: "scope-secret",
      isSecret: true,
      category: "runtime",
      updatedByUserId: "user_foundation_owner",
      updatedByEmail: "owner@daoflow.local",
      updatedByRole: "owner"
    });

    const redactedCaller = appRouter.createCaller({
      requestId: "test-envvars-redacted",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["env:read"])
    });
    const revealedCaller = appRouter.createCaller({
      requestId: "test-envvars-revealed",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["env:read", "secrets:read"])
    });
    const deniedCaller = appRouter.createCaller({
      requestId: "test-envvars-denied",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["deploy:read"])
    });

    const redacted = await redactedCaller.environmentVariables({
      environmentId: "env_daoflow_staging"
    });
    const revealed = await revealedCaller.environmentVariables({
      environmentId: "env_daoflow_staging"
    });

    expect(redacted.variables.find((variable) => variable.key === key)?.displayValue).toBe(
      "[secret]"
    );
    expect(revealed.variables.find((variable) => variable.key === key)?.displayValue).toBe(
      "scope-secret"
    );
    await expect(
      deniedCaller.environmentVariables({ environmentId: "env_daoflow_staging" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: {
        code: "SCOPE_DENIED",
        requiredScopes: ["env:read"]
      }
    });
  });

  it("returns resolved service overrides when a service-scoped inventory view is requested", async () => {
    const serviceResult = await createService({
      name: `envvar-route-service-${Date.now()}`,
      environmentId: "env_daoflow_staging",
      projectId: "proj_daoflow_control_plane",
      sourceType: "compose",
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    if (serviceResult.status !== "ok") {
      throw new Error("Failed to create service-scoped environment variable route fixture.");
    }

    const key = `ROUTE_SCOPE_${Date.now().toString(36).toUpperCase()}`;
    await upsertEnvironmentVariable({
      environmentId: "env_daoflow_staging",
      key,
      value: "shared",
      isSecret: false,
      category: "runtime",
      updatedByUserId: "user_foundation_owner",
      updatedByEmail: "owner@daoflow.local",
      updatedByRole: "owner"
    });
    await upsertEnvironmentVariable({
      environmentId: "env_daoflow_staging",
      serviceId: serviceResult.service.id,
      scope: "service",
      key,
      value: "override",
      isSecret: false,
      category: "runtime",
      updatedByUserId: "user_foundation_owner",
      updatedByEmail: "owner@daoflow.local",
      updatedByRole: "owner"
    });

    const caller = appRouter.createCaller({
      requestId: "test-service-envvar-route",
      session: makeSession("owner")
    });
    const response = await caller.environmentVariables({
      environmentId: "env_daoflow_staging",
      serviceId: serviceResult.service.id
    });

    expect(response.summary.serviceOverrides).toBeGreaterThanOrEqual(1);
    expect(response.variables.filter((variable) => variable.key === key)).toHaveLength(2);
    expect(response.resolvedVariables.find((variable) => variable.key === key)).toMatchObject({
      displayValue: "override",
      scope: "service",
      originSummary: "Service override"
    });
  });

  it("returns infrastructure inventory entries with normalized status tones", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-inventory-status-tones",
      session: makeSession("viewer")
    });
    const response = await caller.infrastructureInventory();

    expect(response.summary.totalServers).toBeGreaterThanOrEqual(0);

    const server = response.servers[0];
    if (server) {
      expect(server.statusTone).toEqual(expect.any(String));
    }

    const project = response.projects[0];
    if (project) {
      expect(project.statusTone).toEqual(expect.any(String));
    }

    const environment = response.environments[0];
    if (environment) {
      expect(environment.statusTone).toEqual(expect.any(String));
    }
  });

  it("returns server readiness checks with normalized status tones", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-server-readiness-status-tones",
      session: makeSession("viewer")
    });
    const response = await caller.serverReadiness({});

    expect(response.summary.totalServers).toBeGreaterThanOrEqual(0);
    expect(response.summary.pollIntervalMs).toBeGreaterThan(0);

    const check = response.checks[0];
    if (!check) {
      return;
    }

    expect(check.statusTone).toEqual(expect.any(String));
    expect(check.dockerVersion === null || typeof check.dockerVersion === "string").toBe(true);
    expect(check.composeVersion === null || typeof check.composeVersion === "string").toBe(true);
  });

  it("registers a server with the async service layer return shape", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-register-server",
      session: makeSession("admin")
    });
    const suffix = Date.now().toString(36);
    const server = await caller.registerServer({
      name: `edge-vps-${suffix}`,
      host: `10.0.9.${Math.floor(Math.random() * 200) + 10}`,
      region: "us-test-1",
      sshPort: 22,
      kind: "docker-engine"
    });

    expect(server.name).toMatch(/^edge-vps-/);
    expect(["ready", "attention", "pending verification"]).toContain(server.status);
  });

  it("registers a docker-swarm-manager target and returns it through server readiness", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-register-swarm-server",
      session: makeSession("admin")
    });
    const suffix = Date.now().toString(36);
    const server = await caller.registerServer({
      name: `swarm-mgr-${suffix}`,
      host: `10.0.10.${Math.floor(Math.random() * 200) + 10}`,
      region: "us-test-1",
      sshPort: 22,
      kind: "docker-swarm-manager"
    });

    expect(server.kind).toBe("docker-swarm-manager");

    const readiness = await caller.serverReadiness({});
    const check = readiness.checks.find((entry) => entry.serverId === server.id);

    expect(check?.targetKind).toBe("docker-swarm-manager");
    expect(check?.swarmTopology?.clusterName).toBe(server.name);
    expect(check?.swarmTopology?.summary.managerCount).toBe(1);
    expect(check?.swarmTopology?.summary.workerCount).toBe(0);
  });

  it("exposes persisted Swarm worker topology through readiness and inventory reads", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-swarm-topology-read-model",
      session: makeSession("admin")
    });
    const suffix = Date.now().toString(36);
    const server = await caller.registerServer({
      name: `swarm-topology-${suffix}`,
      host: `10.0.11.${Math.floor(Math.random() * 200) + 10}`,
      region: "us-test-1",
      sshPort: 22,
      kind: "docker-swarm-manager"
    });

    await db
      .update(servers)
      .set({
        metadata: {
          readinessCheck: {
            readinessStatus: "attention",
            sshReachable: false,
            dockerReachable: false,
            composeReachable: false,
            latencyMs: null,
            checkedAt: new Date().toISOString(),
            issues: [],
            recommendedActions: ["No action required."]
          },
          swarmTopology: {
            clusterId: `swarm-${server.id}`,
            clusterName: "production-swarm",
            source: "manual",
            defaultNamespace: "apps",
            nodes: [
              {
                id: `${server.id}-manager`,
                name: server.name,
                host: server.host,
                role: "manager",
                availability: "active",
                reachability: "reachable",
                managerStatus: "leader"
              },
              {
                id: `${server.id}-worker-1`,
                name: "worker-a",
                host: "10.0.11.50",
                role: "worker",
                availability: "active",
                reachability: "unknown",
                managerStatus: "none"
              },
              {
                id: `${server.id}-worker-2`,
                name: "worker-b",
                host: "10.0.11.51",
                role: "worker",
                availability: "drain",
                reachability: "unreachable",
                managerStatus: "none"
              }
            ]
          }
        }
      })
      .where(eq(servers.id, server.id));

    const readiness = await caller.serverReadiness({});
    const readinessCheck = readiness.checks.find((entry) => entry.serverId === server.id);

    expect(readinessCheck?.swarmTopology?.clusterName).toBe("production-swarm");
    expect(readinessCheck?.swarmTopology?.defaultNamespace).toBe("apps");
    expect(readinessCheck?.swarmTopology?.summary.nodeCount).toBe(3);
    expect(readinessCheck?.swarmTopology?.summary.workerCount).toBe(2);
    expect(readinessCheck?.swarmTopology?.summary.activeNodeCount).toBe(2);
    expect(readinessCheck?.swarmTopology?.summary.reachableNodeCount).toBe(1);

    const inventory = await caller.infrastructureInventory();
    const inventoryServer = inventory.servers.find((entry) => entry.id === server.id);

    expect(inventoryServer?.swarmTopology?.clusterName).toBe("production-swarm");
    expect(inventoryServer?.swarmTopology?.nodes.map((node) => node.role)).toEqual([
      "manager",
      "worker",
      "worker"
    ]);
  });

  it("creates deployment records and returns expanded steps from the mutation", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-create-deployment",
      session: makeSession("developer")
    });
    const inventory = await caller.infrastructureInventory();
    const server = inventory.servers[0];

    expect(inventory.summary.totalServices).toBeGreaterThanOrEqual(0);

    if (!server) {
      return;
    }

    const deployment = await caller.createDeploymentRecord({
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "edge-worker",
      sourceType: "dockerfile",
      targetServerId: server.id,
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/edge-worker:0.2.0",
      steps: [
        {
          label: "Render runtime spec",
          detail: "Freeze Dockerfile inputs."
        },
        {
          label: "Queue execution handoff",
          detail: "Wait for worker dispatch."
        }
      ]
    });

    expect(deployment.serviceName).toBe("edge-worker");
    expect(deployment.projectId).toEqual(expect.any(String));
    expect(deployment.steps).toHaveLength(2);
    expect(deployment.steps.map((step) => step.position)).toEqual([1, 2]);
  });

  it("creates notification channels and stores user notification preferences", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-notifications",
      session: makeSession("admin")
    });
    const channelName = `Ops ${Date.now().toString(36)}`;

    const created = await caller.createChannel({
      name: channelName,
      channelType: "email",
      email: "ops@daoflow.local",
      eventSelectors: ["deploy.*"],
      enabled: true
    });

    expect(created.id).toEqual(expect.any(String));

    const channels = await caller.listChannels();
    expect(channels.some((channel) => channel.name === channelName)).toBe(true);

    await caller.setUserPreference({
      eventType: "deploy.*",
      channelType: "email",
      enabled: false
    });

    const preferences = await caller.getUserPreferences();
    expect(
      preferences.some(
        (preference) =>
          preference.eventType === "deploy.*" &&
          preference.channelType === "email" &&
          preference.enabled === false
      )
    ).toBe(true);
  });

  it("sends test notifications to the configured email recipient", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-notification-email",
      session: makeSession("admin")
    });

    const created = await caller.createChannel({
      name: `Email ${Date.now().toString(36)}`,
      channelType: "email",
      email: "alerts@daoflow.local",
      eventSelectors: ["*"],
      enabled: true
    });

    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFrom = process.env.RESEND_FROM;
    const deliveries: Array<{ to: string[]; subject: string }> = [];

    process.env.RESEND_API_KEY = "resend_test_key";
    process.env.RESEND_FROM = "DaoFlow <noreply@daoflow.local>";
    globalThis.fetch = ((_input: URL | string | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "{}";
      deliveries.push(JSON.parse(body) as { to: string[]; subject: string });
      return Promise.resolve(
        new Response(JSON.stringify({ id: "email_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }) as typeof fetch;

    try {
      const result = await caller.testChannel({ id: created.id });
      expect(result.succeeded).toBe(1);
      expect(deliveries).toEqual([
        expect.objectContaining({
          to: ["alerts@daoflow.local"]
        })
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalApiKey;
      }
      if (originalFrom === undefined) {
        delete process.env.RESEND_FROM;
      } else {
        process.env.RESEND_FROM = originalFrom;
      }
    }
  });

  it("dispatches deploy notifications for execution lifecycle events", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-deploy-notifications",
      session: makeSession("admin")
    });

    await caller.createChannel({
      name: `Deploy Webhook ${Date.now().toString(36)}`,
      channelType: "generic_webhook",
      webhookUrl: "https://hooks.example.com/deploys",
      eventSelectors: ["deploy.*"],
      enabled: true
    });

    const originalFetch = globalThis.fetch;
    const eventsSent: string[] = [];
    globalThis.fetch = ((_input: URL | string | Request, init?: RequestInit) => {
      eventsSent.push(new Headers(init?.headers).get("X-DaoFlow-Event") ?? "unknown");
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as typeof fetch;

    try {
      const first = await caller.createDeploymentRecord({
        projectName: "DaoFlow",
        environmentName: "staging",
        serviceName: `notify-success-${Date.now().toString(36)}`.slice(0, 24),
        sourceType: "dockerfile",
        targetServerId: "srv_foundation_1",
        commitSha: "abcdef1",
        imageTag: "ghcr.io/daoflow/notify:success",
        steps: [
          { label: "Prepare", detail: "Render deployment inputs." },
          { label: "Queue", detail: "Queue worker execution." }
        ]
      });
      await caller.dispatchExecutionJob({ jobId: first.id });
      await caller.completeExecutionJob({ jobId: first.id });

      const second = await caller.createDeploymentRecord({
        projectName: "DaoFlow",
        environmentName: "staging",
        serviceName: `notify-fail-${Date.now().toString(36)}`.slice(0, 24),
        sourceType: "dockerfile",
        targetServerId: "srv_foundation_1",
        commitSha: "abcdef2",
        imageTag: "ghcr.io/daoflow/notify:failed",
        steps: [
          { label: "Prepare", detail: "Render deployment inputs." },
          { label: "Queue", detail: "Queue worker execution." }
        ]
      });
      await caller.dispatchExecutionJob({ jobId: second.id });
      await caller.failExecutionJob({ jobId: second.id, reason: "Health check timed out." });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const logs = await db.select().from(notificationLogs);
    const deployEvents = logs
      .filter((log) =>
        ["deploy.started", "deploy.succeeded", "deploy.failed"].includes(log.eventType)
      )
      .map((log) => log.eventType);

    expect(deployEvents).toEqual(
      expect.arrayContaining(["deploy.started", "deploy.succeeded", "deploy.failed"])
    );
    expect(eventsSent).toEqual(
      expect.arrayContaining(["deploy.started", "deploy.succeeded", "deploy.failed"])
    );
  });

  it("returns execution queue jobs without queue-specific metadata", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-execution",
      session: makeSession("viewer")
    });
    const response = await caller.executionQueue({});

    expect(response.summary.totalJobs).toBeGreaterThanOrEqual(0);

    const job = response.jobs[0];
    if (!job) {
      return;
    }

    expect(job.targetServerId).toEqual(expect.any(String));
    expect(job.queueName).toEqual(expect.any(String));
    expect(job.statusTone).toEqual(expect.any(String));
  });

  it("returns operations timeline entries with normalized lifecycle metadata", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-operations-timeline",
      session: makeSession("viewer")
    });
    const response = await caller.operationsTimeline({});

    expect(Array.isArray(response)).toBe(true);

    const event = response[0];
    if (!event) {
      return;
    }

    expect(event.statusLabel).toEqual(expect.any(String));
    expect(event.statusTone).toEqual(expect.any(String));
  });

  it("returns backup inventory and restore queue with current fields", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backups",
      session: makeSession("viewer")
    });

    const overview = await caller.backupOverview({});
    const restoreQueue = await caller.backupRestoreQueue({});
    const persistentVolumes = await caller.persistentVolumes({});

    expect(overview.summary.totalPolicies).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(overview.policies)).toBe(true);
    expect(Array.isArray(overview.runs)).toBe(true);
    expect(restoreQueue.summary.totalRequests).toBeGreaterThanOrEqual(0);
    expect(persistentVolumes.summary.totalVolumes).toBeGreaterThanOrEqual(0);

    const run = overview.runs[0];
    if (run) {
      expect(run.statusTone).toEqual(expect.any(String));
      expect(run.executionEngine === "legacy" || run.executionEngine === "temporal").toBe(true);
    }

    const request = restoreQueue.requests[0];
    if (request) {
      expect(request.statusTone).toEqual(expect.any(String));
    }

    const volume = persistentVolumes.volumes[0];
    if (volume) {
      expect(volume.statusTone).toEqual(expect.any(String));
    }

    const policy = overview.policies[0];
    if (policy) {
      expect(policy.executionEngine === "legacy" || policy.executionEngine === "temporal").toBe(
        true
      );
    }
  });

  it("returns backup run details with persisted log state", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backup-run-details",
      session: makeSession("viewer")
    });

    const run = await caller.backupRunDetails({
      runId: "brun_foundation_db_failed"
    });

    expect(run.status).toBe("failed");
    expect(run.logsState).toBe("available");
    expect(run.logEntries.length).toBeGreaterThan(0);
    expect(run.error).toContain("pg_dump");
  });

  it("returns a non-mutating backup restore plan from the planning lane", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backup-restore-plan",
      session: makeSession("viewer")
    });

    const restoresBefore = await db
      .select({ id: backupRestores.id })
      .from(backupRestores)
      .where(eq(backupRestores.backupRunId, "brun_foundation_volume_success"));

    const plan = await caller.backupRestorePlan({
      backupRunId: "brun_foundation_volume_success"
    });

    const restoresAfter = await db
      .select({ id: backupRestores.id })
      .from(backupRestores)
      .where(eq(backupRestores.backupRunId, "brun_foundation_volume_success"));

    expect(plan.isReady).toBe(true);
    expect(plan.backupRun.id).toBe("brun_foundation_volume_success");
    expect(plan.backupRun.artifactPath).toContain("postgres-volume-2026-03-11.tar.zst");
    expect(plan.target.path).toBe("/var/lib/postgresql/data");
    expect(plan.executeCommand).toBe(
      "daoflow backup restore --backup-run-id brun_foundation_volume_success --yes"
    );
    expect(plan.approvalRequest.procedure).toBe("requestApproval");
    expect(plan.approvalRequest.requiredScope).toBe("approvals:create");
    expect(restoresAfter).toHaveLength(restoresBefore.length);
  });

  it("denies backup read procedures when a token omits backup:read", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backup-read-scope-denied",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["deploy:read"])
    });

    await expect(caller.backupOverview({})).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: {
        code: "SCOPE_DENIED",
        requiredScopes: ["backup:read"],
        grantedScopes: ["deploy:read"]
      }
    });

    await expect(
      caller.backupRunDetails({
        runId: "brun_foundation_db_failed"
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: {
        code: "SCOPE_DENIED",
        requiredScopes: ["backup:read"],
        grantedScopes: ["deploy:read"]
      }
    });

    await expect(
      caller.backupRestorePlan({
        backupRunId: "brun_foundation_volume_success"
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: {
        code: "SCOPE_DENIED",
        requiredScopes: ["backup:read"],
        grantedScopes: ["deploy:read"]
      }
    });
  });

  it("allows backup read procedures when a token includes backup:read", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backup-read-scope-allowed",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["backup:read"])
    });

    const overview = await caller.backupOverview({});
    const run = await caller.backupRunDetails({
      runId: "brun_foundation_db_failed"
    });
    const plan = await caller.backupRestorePlan({
      backupRunId: "brun_foundation_volume_success"
    });

    expect(overview.summary.totalPolicies).toBeGreaterThanOrEqual(0);
    expect(run.id).toBe("brun_foundation_db_failed");
    expect(plan.backupRun.id).toBe("brun_foundation_volume_success");
  });

  it("denies persistent volume inventory when a token omits volumes:read", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-volume-read-scope-denied",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["backup:read"])
    });

    await expect(caller.persistentVolumes({})).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: {
        code: "SCOPE_DENIED",
        requiredScopes: ["volumes:read"],
        grantedScopes: ["backup:read"]
      }
    });
  });

  it("requires volumes:write for volume registration", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-volume-write-scope-denied",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["volumes:read"])
    });

    await expect(
      caller.createVolume({
        name: `scope-test-volume-${Date.now().toString(36)}`,
        serverId: "srv_foundation_1",
        mountPath: "/srv/scope"
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: {
        code: "SCOPE_DENIED",
        requiredScopes: ["volumes:write"],
        grantedScopes: ["volumes:read"]
      }
    });
  });

  it("registers volumes and backup policies through the command router", async () => {
    const suffix = Date.now().toString(36);
    const caller = appRouter.createCaller({
      requestId: "test-storage-crud",
      session: makeSession("owner")
    });

    const volume = await caller.createVolume({
      name: `policy-volume-${suffix}`,
      serverId: "srv_foundation_1",
      mountPath: `/srv/policy-${suffix}`,
      driver: "local"
    });

    const destination = await caller.createBackupDestination({
      name: `dest-${suffix}`,
      provider: "local",
      localPath: `/tmp/daoflow-${suffix}`
    });

    if (!volume || !destination) {
      throw new Error("Expected storage mutations to return created volume and destination.");
    }

    const policy = await caller.createBackupPolicy({
      name: `policy-${suffix}`,
      volumeId: volume.id,
      destinationId: destination.id,
      retentionDays: 21
    });

    if (!policy) {
      throw new Error("Expected storage mutations to return a created backup policy.");
    }

    const updated = await caller.updateBackupPolicy({
      policyId: policy.id,
      retentionDays: 30,
      turnOff: true
    });

    if (!updated) {
      throw new Error("Expected storage mutations to return an updated backup policy.");
    }

    expect(updated.retentionDays).toBe(30);
    expect(updated.turnOff).toBe(true);

    await expect(caller.deleteVolume({ volumeId: volume.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED"
    });

    await expect(caller.deleteBackupPolicy({ policyId: policy.id })).resolves.toEqual({
      deleted: true,
      policyId: policy.id
    });

    await expect(caller.deleteVolume({ volumeId: volume.id })).resolves.toEqual({
      deleted: true,
      volumeId: volume.id
    });

    const deletedVolume = await db.select().from(volumes).where(eq(volumes.id, volume.id)).limit(1);
    const deletedPolicy = await db
      .select()
      .from(backupPolicies)
      .where(eq(backupPolicies.id, policy.id))
      .limit(1);

    expect(deletedVolume).toHaveLength(0);
    expect(deletedPolicy).toHaveLength(0);
  });

  it("returns approval requests keyed by targetResource", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-approvals",
      session: makeSession("viewer")
    });
    const response = await caller.approvalQueue({});

    expect(response.summary.totalRequests).toBeGreaterThanOrEqual(0);

    const request = response.requests[0];
    if (!request) {
      return;
    }

    expect(request.targetResource).toEqual(expect.any(String));
    expect(request.resourceLabel).toEqual(expect.any(String));
    expect(request.statusTone).toEqual(expect.any(String));
  });

  it("blocks self-approval and records the failed decision attempt", async () => {
    const requester = appRouter.createCaller({
      requestId: "test-approval-self-block-request",
      session: makeSession("admin")
    });

    const catalog = await requester.composeReleaseCatalog({});
    const service = catalog.services.find((candidate) => candidate.imageReference.length > 0);

    if (!service) {
      return;
    }

    const request = await requester.requestApproval({
      actionType: "compose-release",
      composeServiceId: service.id,
      commitSha: "abcdef1",
      imageTag: `${service.imageReference}-candidate`,
      reason: "Need a second operator before promoting this compose release."
    });

    const approver = appRouter.createCaller({
      requestId: "test-approval-self-block-approve",
      session: makeSession("admin")
    });

    await expect(
      approver.approveApprovalRequest({
        requestId: request.id
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Approval request must be decided by a different principal."
    } satisfies Partial<TRPCError>);

    const [storedRequest] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, request.id))
      .limit(1);
    expect(storedRequest?.status).toBe("pending");

    const auditRows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `approval-request/${request.id}`));
    const failedDecision = auditRows.find(
      (row) => row.action === "approval.approve" && row.outcome === "failure"
    );
    expect(failedDecision?.inputSummary).toContain("Blocked self-approval");
  });

  it("dispatches approval notifications for request and decision events", async () => {
    const requester = appRouter.createCaller({
      requestId: "test-approval-notifications-requester",
      session: makeSession("admin")
    });
    const approver = appRouter.createCaller({
      requestId: "test-approval-notifications-approver",
      session: makeSession("operator")
    });

    await requester.createChannel({
      name: `Approval Webhook ${Date.now().toString(36)}`,
      channelType: "generic_webhook",
      webhookUrl: "https://hooks.example.com/approvals",
      eventSelectors: ["approval.*"],
      enabled: true
    });

    const originalFetch = globalThis.fetch;
    const eventsSent: string[] = [];
    globalThis.fetch = ((_input: URL | string | Request, init?: RequestInit) => {
      eventsSent.push(new Headers(init?.headers).get("X-DaoFlow-Event") ?? "unknown");
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as typeof fetch;

    try {
      const catalog = await requester.composeReleaseCatalog({});
      const service = catalog.services.find((candidate) => candidate.imageReference.length > 0);
      if (!service) {
        return;
      }

      const approved = await requester.requestApproval({
        actionType: "compose-release",
        composeServiceId: service.id,
        commitSha: "abcdef1",
        imageTag: `${service.imageReference}-candidate`,
        reason: "Need a second operator before promoting this compose release."
      });
      await approver.approveApprovalRequest({ requestId: approved.id });

      const rejected = await requester.requestApproval({
        actionType: "compose-release",
        composeServiceId: service.id,
        commitSha: "abcdef2",
        imageTag: `${service.imageReference}-rejected`,
        reason: "Need a second operator before promoting this alternate release."
      });
      await approver.rejectApprovalRequest({ requestId: rejected.id });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const logs = await db.select().from(notificationLogs);
    const approvalEvents = logs
      .filter((log) =>
        ["approval.request", "approval.approve", "approval.reject"].includes(log.eventType)
      )
      .map((log) => log.eventType);

    expect(approvalEvents).toEqual(
      expect.arrayContaining(["approval.request", "approval.approve", "approval.reject"])
    );
    expect(eventsSent).toEqual(
      expect.arrayContaining(["approval.request", "approval.approve", "approval.reject"])
    );
  });

  it("returns token inventory entries keyed by name", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-token-inventory",
      session: makeSession("admin")
    });
    const response = await caller.agentTokenInventory();

    expect(response.summary.totalTokens).toBeGreaterThanOrEqual(0);

    const token = response.tokens[0];
    if (!token) {
      return;
    }

    expect(token.name).toEqual(expect.any(String));
    expect(token.label).toEqual(expect.any(String));
    expect(token.statusTone).toEqual(expect.any(String));
  });

  it("filters project inventory to the caller's active team", async () => {
    const fixture = await createOtherTeamFixture();
    const caller = appRouter.createCaller({
      requestId: "test-project-team-scope-list",
      session: makeSession("owner")
    });

    const response = await caller.projects({ limit: 50 });

    expect(response.some((project) => project.id === fixture.projectId)).toBe(false);
  });

  it("rejects project detail reads outside the caller's team", async () => {
    const fixture = await createOtherTeamFixture();
    const caller = appRouter.createCaller({
      requestId: "test-project-team-scope-detail",
      session: makeSession("owner")
    });

    await expect(caller.projectDetails({ projectId: fixture.projectId })).rejects.toMatchObject({
      code: "NOT_FOUND"
    } satisfies Partial<TRPCError>);
    await expect(
      caller.projectEnvironments({ projectId: fixture.projectId })
    ).rejects.toMatchObject({
      code: "NOT_FOUND"
    } satisfies Partial<TRPCError>);
    await expect(caller.projectServices({ projectId: fixture.projectId })).rejects.toMatchObject({
      code: "NOT_FOUND"
    } satisfies Partial<TRPCError>);
  });

  it("rejects project and environment mutations outside the caller's team", async () => {
    const fixture = await createOtherTeamFixture();
    const caller = appRouter.createCaller({
      requestId: "test-project-team-scope-mutation",
      session: makeCustomSession({
        id: fixture.userId,
        email: `${fixture.userId}@daoflow.local`,
        name: "Other Team Admin",
        role: "admin"
      })
    });

    await expect(caller.deleteProject({ projectId: "proj_foundation_1" })).rejects.toMatchObject({
      code: "NOT_FOUND"
    } satisfies Partial<TRPCError>);
    await expect(
      caller.createEnvironment({
        projectId: "proj_foundation_1",
        name: "blocked-env"
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND"
    } satisfies Partial<TRPCError>);
    await expect(caller.deleteEnvironment({ environmentId: "env_prod_1" })).rejects.toMatchObject({
      code: "NOT_FOUND"
    } satisfies Partial<TRPCError>);
  });

  it("rejects project deletion while deployments are still running", async () => {
    const projectResult = await createProject({
      name: `delete-guard-project-${Date.now()}`,
      description: "Project delete guard fixture",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create delete guard project.");
    }

    const environmentResult = await createEnvironment({
      projectId: projectResult.project.id,
      name: `delete-guard-env-${Date.now()}`,
      targetServerId: "srv_foundation_1",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(environmentResult.status).toBe("ok");
    if (environmentResult.status !== "ok") {
      throw new Error("Failed to create delete guard environment.");
    }

    const serviceResult = await createService({
      name: `delete-guard-svc-${Date.now()}`,
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
      throw new Error("Failed to create delete guard service.");
    }

    await db.insert(deployments).values({
      id: `depguard${Date.now()}`.slice(0, 32),
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
      targetServerId: "srv_foundation_1",
      serviceName: serviceResult.service.name,
      sourceType: "compose",
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
      imageTag: "ghcr.io/example/delete-guard:test",
      status: "deploy",
      configSnapshot: {
        projectName: projectResult.project.name,
        environmentName: environmentResult.environment.name
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const caller = appRouter.createCaller({
      requestId: "test-project-delete-active-deployment",
      session: makeSession("owner")
    });

    await expect(
      caller.deleteProject({ projectId: projectResult.project.id })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Project deletion is blocked while deployments are still queued or running. Cancel or wait for them to finish first."
    } satisfies Partial<TRPCError>);
  });

  it("rejects environment variable reads and writes outside the caller's team", async () => {
    const fixture = await createOtherTeamFixture();
    await upsertEnvironmentVariable({
      environmentId: fixture.environmentId,
      key: "TEAM_SCOPED_SECRET",
      value: "other-team-secret",
      isSecret: true,
      category: "runtime",
      updatedByUserId: fixture.userId,
      updatedByEmail: `${fixture.userId}@daoflow.local`,
      updatedByRole: "owner"
    });

    const caller = appRouter.createCaller({
      requestId: "test-envvar-team-scope",
      session: makeSession("owner")
    });

    const response = await caller.environmentVariables({ environmentId: fixture.environmentId });
    expect(response.variables).toHaveLength(0);

    await expect(
      caller.upsertEnvironmentVariable({
        environmentId: fixture.environmentId,
        key: "TEAM_SCOPED_SECRET",
        value: "attempted-cross-team-write",
        isSecret: true,
        category: "runtime"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<TRPCError>);

    await expect(
      caller.deleteEnvironmentVariable({
        environmentId: fixture.environmentId,
        key: "TEAM_SCOPED_SECRET"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<TRPCError>);
  });

  // ─── RBAC enforcement tests ─────────────────────────────────

  it("viewer cannot create agents (admin-only route)", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-rbac-viewer-agent",
      session: makeSession("viewer")
    });

    await expect(
      caller.createAgent({
        name: "test-agent",
        preset: "agent:read-only"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
  });

  it("developer cannot create agents (admin-only route)", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-rbac-dev-agent",
      session: makeSession("developer")
    });

    await expect(
      caller.createAgent({
        name: "test-agent",
        preset: "agent:read-only"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
  });

  it("admin can create agent with preset (full end-to-end)", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-admin-create-agent",
      session: makeSession("admin")
    });

    const agent = await caller.createAgent({
      name: `preset-agent-${Date.now().toString(36)}`,
      preset: "agent:read-only"
    });

    expect(agent.name).toContain("preset-agent-");
    expect(agent.type).toBe("agent");
    expect(agent.status).toBe("active");
    // Verify scopes were resolved from preset
    const scopeList = (agent.defaultScopes ?? "").split(",").filter(Boolean);
    expect(scopeList).toContain("server:read");
    expect(scopeList).toContain("deploy:read");
    expect(scopeList).toContain("logs:read");
    // Read-only preset should not have write scopes
    expect(scopeList).not.toContain("deploy:start");
    expect(scopeList).not.toContain("env:write");
  });

  it("admin can create agent with minimal-write preset", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-admin-minwrite",
      session: makeSession("admin")
    });

    const agent = await caller.createAgent({
      name: `minwrite-agent-${Date.now().toString(36)}`,
      preset: "agent:minimal-write"
    });

    const scopeList = (agent.defaultScopes ?? "").split(",").filter(Boolean);
    // Has read scopes
    expect(scopeList).toContain("server:read");
    expect(scopeList).toContain("logs:read");
    // Has write scopes
    expect(scopeList).toContain("deploy:start");
    expect(scopeList).toContain("env:write");
    // But not server:write (that's full-only)
    expect(scopeList).not.toContain("server:write");
  });

  it("admin can create agent with full preset", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-admin-full",
      session: makeSession("admin")
    });

    const agent = await caller.createAgent({
      name: `full-agent-${Date.now().toString(36)}`,
      preset: "agent:full"
    });

    const scopeList = (agent.defaultScopes ?? "").split(",").filter(Boolean);
    expect(scopeList).toContain("server:write");
    expect(scopeList).toContain("backup:run");
    expect(scopeList).toContain("backup:restore");
    // But not admin-only
    expect(scopeList).not.toContain("terminal:open");
    expect(scopeList).not.toContain("tokens:manage");
  });

  it("viewer cannot register a server (admin-only route)", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-rbac-viewer-server",
      session: makeSession("viewer")
    });

    await expect(
      caller.registerServer({
        name: "forbidden-server",
        host: "10.0.0.1",
        region: "us-test",
        sshPort: 22,
        kind: "docker-engine"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
  });
});
