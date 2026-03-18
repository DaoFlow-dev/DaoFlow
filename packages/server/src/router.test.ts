import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { Context } from "./context";
import { db } from "./db/connection";
import { deployments } from "./db/schema/deployments";
import { createEnvironment, createProject } from "./db/services/projects";
import { createService } from "./db/services/services";
import { appRouter } from "./router";

let rollbackFixtureCounter = 0;

function makeSession(role: string): NonNullable<Context["session"]> {
  const seededUsers = {
    owner: {
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner"
    },
    admin: {
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner"
    },
    viewer: {
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner"
    },
    operator: {
      id: "user_foundation_operator",
      email: "operator@daoflow.local",
      name: "Foundation Operator"
    },
    developer: {
      id: "user_developer",
      email: "developer@daoflow.local",
      name: "Foundation Developer"
    },
    agent: {
      id: "user_observer_agent",
      email: "observer-agent@daoflow.local",
      name: "Observer Agent"
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

async function createRollbackFixture() {
  rollbackFixtureCounter += 1;
  const suffix = `${Date.now()}_${rollbackFixtureCounter}`;
  const projectName = `rollback-fixture-${suffix}`;
  const environmentName = `preview-${suffix}`;
  const serviceName = `svc-${suffix}`;

  const projectResult = await createProject({
    name: projectName,
    description: "Rollback planning fixture",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create rollback fixture project.");
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
    throw new Error("Failed to create rollback fixture environment.");
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
    throw new Error("Failed to create rollback fixture service.");
  }

  const successDeploymentId = `depok_${suffix}`.slice(0, 32);
  const failedDeploymentId = `depfail_${suffix}`.slice(0, 32);
  const successCreatedAt = new Date(Date.now() - 5 * 60 * 1000);
  const failedCreatedAt = new Date(Date.now() - 60 * 1000);

  await db.insert(deployments).values([
    {
      id: successDeploymentId,
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
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
      projectId: projectResult.project.id,
      environmentId: environmentResult.environment.id,
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
    serviceId: serviceResult.service.id,
    successDeploymentId,
    failedDeploymentId
  };
}

describe("appRouter", () => {
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
    expect(Array.isArray(deployment.steps)).toBe(true);

    const details = await caller.deploymentDetails({
      deploymentId: deployment.id
    });

    expect(details.id).toBe(deployment.id);
    expect(Array.isArray(details.steps)).toBe(true);
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

  it("returns a real deployment plan from the planning lane", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-plan",
      session: makeSession("viewer")
    });

    const services = await caller.services({});
    const service = services[0];

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

  it("returns deployment logs keyed by level", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-logs",
      session: makeSession("viewer")
    });
    const response = await caller.deploymentLogs({});

    expect(response.summary.totalLines).toBeGreaterThanOrEqual(0);

    const line = response.lines[0];
    if (!line) {
      return;
    }

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

    const check = response.checks[0];
    if (!check) {
      return;
    }

    expect(check.statusTone).toEqual(expect.any(String));
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
    }

    const request = restoreQueue.requests[0];
    if (request) {
      expect(request.statusTone).toEqual(expect.any(String));
    }

    const volume = persistentVolumes.volumes[0];
    if (volume) {
      expect(volume.statusTone).toEqual(expect.any(String));
    }
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
