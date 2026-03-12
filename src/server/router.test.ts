import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { Context } from "./context";
import { appRouter } from "./router";

function makeSession(role: string): NonNullable<Context["session"]> {
  return {
    user: {
      id: `user_${role}`,
      email: `${role}@daoflow.local`,
      name: role[0]?.toUpperCase() ? `${role[0].toUpperCase()}${role.slice(1)}` : role,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      image: null,
      role
    },
    session: {
      id: `session_${role}`,
      userId: `user_${role}`,
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

  it("filters roadmap items by lane", async () => {
    const caller = appRouter.createCaller({ requestId: "test-roadmap", session: null });
    const response = await caller.roadmap({ lane: "agent-safety" });

    expect(response).toHaveLength(1);
    expect(response[0]?.lane).toBe("agent-safety");
  });

  it("returns seeded deployment records for signed-in users", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-deployments",
      session: makeSession("viewer")
    });
    const response = await caller.recentDeployments({});

    expect(response.length).toBeGreaterThan(0);
    expect(response[0]?.projectName).toBe("DaoFlow");
    expect(response[0]?.steps.length).toBeGreaterThan(0);
  });

  it("rejects protected procedures without a session", async () => {
    const caller = appRouter.createCaller({ requestId: "test-viewer", session: null });

    await expect(caller.viewer()).rejects.toBeInstanceOf(TRPCError);
  });

  it("returns viewer data for an authenticated session", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-viewer-ok",
      session: makeSession("owner")
    });

    const response = await caller.viewer();
    expect(response.user.email).toBe("owner@daoflow.local");
    expect(response.authz.role).toBe("owner");
    expect(response.authz.capabilities).toContain("roles.manage");
  });

  it("blocks admin procedures for non-admin roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-admin-viewer",
      session: makeSession("viewer")
    });

    await expect(caller.adminControlPlane()).rejects.toBeInstanceOf(TRPCError);
  });

  it("returns admin control-plane data for elevated roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-admin-owner",
      session: makeSession("owner")
    });

    const response = await caller.adminControlPlane();
    expect(response.operator.role).toBe("owner");
    expect(response.governance.defaultSignupRole).toBe("viewer");
  });

  it("blocks api token inventory for non-admin roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-token-viewer",
      session: makeSession("viewer")
    });

    await expect(caller.agentTokenInventory()).rejects.toBeInstanceOf(TRPCError);
  });

  it("returns scoped api token inventory for elevated roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-token-owner",
      session: makeSession("owner")
    });

    const response = await caller.agentTokenInventory();
    const readOnlyToken = response.tokens.find((token) => token.label === "readonly-observer");
    const plannerToken = response.tokens.find((token) => token.label === "planner-agent");

    expect(response.summary.totalTokens).toBeGreaterThanOrEqual(3);
    expect(response.summary.readOnlyTokens).toBeGreaterThanOrEqual(1);
    expect(readOnlyToken?.isReadOnly).toBe(true);
    expect(readOnlyToken?.lanes).toEqual(["read"]);
    expect(readOnlyToken?.effectiveCapabilities).not.toContain("deploy.execute");
    expect(plannerToken?.lanes).toContain("planning");
  });

  it("returns deployment details for a known deployment record", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-deployment-details",
      session: makeSession("viewer")
    });
    const deployments = await caller.recentDeployments({});
    const firstDeployment = deployments[0];

    expect(firstDeployment).toBeDefined();
    if (!firstDeployment) {
      throw new Error("Expected a seeded deployment record.");
    }

    const response = await caller.deploymentDetails({
      deploymentId: firstDeployment.id
    });

    expect(response.id).toBe(firstDeployment.id);
    expect(response.steps.length).toBeGreaterThan(0);
  });

  it("creates queued deployment records for deploy-capable roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-create-deployment",
      session: makeSession("developer")
    });

    const response = await caller.createDeploymentRecord({
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "edge-worker",
      sourceType: "dockerfile",
      targetServerId: "srv_foundation_1",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/edge-worker:0.2.0",
      steps: [
        {
          label: "Render runtime spec",
          detail: "Freeze the Dockerfile build inputs for staging."
        },
        {
          label: "Queue execution handoff",
          detail: "Wait for a worker to pick up the queued deployment."
        }
      ]
    });

    expect(response.status).toBe("queued");
    expect(response.requestedByEmail).toBe("developer@daoflow.local");
    expect(response.steps).toHaveLength(2);
    expect(response.steps[0]?.status).toBe("pending");

    const deployments = await caller.recentDeployments({});
    expect(deployments[0]?.id).toBe(response.id);
  });

  it("blocks queued deployment creation for viewer roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-create-deployment-viewer",
      session: makeSession("viewer")
    });

    await expect(
      caller.createDeploymentRecord({
        projectName: "DaoFlow",
        environmentName: "staging",
        serviceName: "edge-worker",
        sourceType: "dockerfile",
        targetServerId: "srv_foundation_1",
        commitSha: "abcdef1",
        imageTag: "ghcr.io/daoflow/edge-worker:0.2.0",
        steps: [
          {
            label: "Render runtime spec",
            detail: "Freeze the Dockerfile build inputs for staging."
          }
        ]
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
