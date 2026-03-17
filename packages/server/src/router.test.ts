import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { Context } from "./context";
import { appRouter } from "./router";

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
    }

    expect(drift.summary.totalServices).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(drift.reports)).toBe(true);
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
    expect(server.status).toBe("pending verification");
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
  });

  it("returns backup inventory and restore queue with current fields", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backups",
      session: makeSession("viewer")
    });

    const overview = await caller.backupOverview({});
    const restoreQueue = await caller.backupRestoreQueue({});

    expect(overview.summary.totalPolicies).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(overview.policies)).toBe(true);
    expect(Array.isArray(overview.runs)).toBe(true);
    expect(restoreQueue.summary.totalRequests).toBeGreaterThanOrEqual(0);
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
