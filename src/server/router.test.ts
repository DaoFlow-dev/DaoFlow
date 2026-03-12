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

  it("returns execution queue and operations timeline for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-execution-viewer",
      session: makeSession("viewer")
    });

    const queue = await caller.executionQueue({});
    const timeline = await caller.operationsTimeline({});

    expect(queue.jobs.length).toBeGreaterThan(0);
    expect(queue.summary.completedJobs + queue.summary.failedJobs).toBeGreaterThan(0);
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0]?.serviceName).toBeTruthy();
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

  it("blocks execution lifecycle mutations for viewer roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-execution-viewer-block",
      session: makeSession("viewer")
    });

    await expect(
      caller.dispatchExecutionJob({
        jobId: "job_foundation_20260312_1"
      })
    ).rejects.toBeInstanceOf(TRPCError);
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

    const queue = await caller.executionQueue({
      status: "pending"
    });
    const queuedJob = queue.jobs.find((job) => job.deploymentId === response.id);
    expect(queuedJob?.status).toBe("pending");
    expect(queuedJob?.queueName).toBe("docker-ssh");

    const timeline = await caller.operationsTimeline({
      deploymentId: response.id
    });
    expect(timeline.some((event) => event.kind === "deployment.queued")).toBe(true);
    expect(timeline.some((event) => event.kind === "execution.job.created")).toBe(true);
  });

  it("advances execution jobs through dispatch and completion", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-job-complete",
      session: makeSession("operator")
    });

    const deployment = await caller.createDeploymentRecord({
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "queue-worker",
      sourceType: "dockerfile",
      targetServerId: "srv_foundation_1",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/queue-worker:0.2.0",
      steps: [
        {
          label: "Render runtime spec",
          detail: "Prepare the runtime inputs."
        },
        {
          label: "Queue execution handoff",
          detail: "Wait for the worker."
        }
      ]
    });
    const pendingQueue = await caller.executionQueue({
      status: "pending"
    });
    const job = pendingQueue.jobs.find((entry) => entry.deploymentId === deployment.id);

    expect(job).toBeDefined();
    if (!job) {
      throw new Error("Expected a pending execution job.");
    }

    const dispatchedJob = await caller.dispatchExecutionJob({
      jobId: job.id
    });
    expect(dispatchedJob?.status).toBe("dispatched");

    const completedJob = await caller.completeExecutionJob({
      jobId: job.id
    });
    expect(completedJob?.status).toBe("completed");

    const updatedDeployment = await caller.deploymentDetails({
      deploymentId: deployment.id
    });
    expect(updatedDeployment.status).toBe("healthy");
    expect(updatedDeployment.steps.every((step) => step.status === "completed")).toBe(true);

    const timeline = await caller.operationsTimeline({
      deploymentId: deployment.id
    });
    expect(timeline.some((event) => event.kind === "execution.job.dispatched")).toBe(true);
    expect(timeline.some((event) => event.kind === "deployment.succeeded")).toBe(true);
  });

  it("fails dispatched execution jobs and blocks invalid transitions", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-job-fail",
      session: makeSession("operator")
    });

    const deployment = await caller.createDeploymentRecord({
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "broken-worker",
      sourceType: "dockerfile",
      targetServerId: "srv_foundation_1",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/broken-worker:0.2.0",
      steps: [
        {
          label: "Render runtime spec",
          detail: "Prepare the runtime inputs."
        }
      ]
    });
    const pendingQueue = await caller.executionQueue({
      status: "pending"
    });
    const job = pendingQueue.jobs.find((entry) => entry.deploymentId === deployment.id);

    expect(job).toBeDefined();
    if (!job) {
      throw new Error("Expected a pending execution job.");
    }

    await caller.dispatchExecutionJob({
      jobId: job.id
    });
    const failedJob = await caller.failExecutionJob({
      jobId: job.id,
      reason: "Simulated rollout failure."
    });
    expect(failedJob?.status).toBe("failed");

    const updatedDeployment = await caller.deploymentDetails({
      deploymentId: deployment.id
    });
    expect(updatedDeployment.status).toBe("failed");
    expect(updatedDeployment.steps.some((step) => step.status === "failed")).toBe(true);

    await expect(
      caller.completeExecutionJob({
        jobId: job.id
      })
    ).rejects.toBeInstanceOf(TRPCError);
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
