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

  it("returns compose release catalog for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-catalog-viewer",
      session: makeSession("viewer")
    });

    const catalog = await caller.composeReleaseCatalog({});
    const productionControlPlane = catalog.services.find(
      (service) => service.id === "compose_daoflow_prod_control_plane"
    );

    expect(catalog.summary).toEqual({
      totalServices: 5,
      statefulServices: 5,
      healthyEnvironments: 1,
      uniqueNetworks: 3
    });
    expect(productionControlPlane).toMatchObject({
      environmentName: "production-us-west",
      projectName: "DaoFlow",
      targetServerName: "foundation-vps-1",
      serviceName: "control-plane",
      composeFilePath: "/srv/daoflow/production/compose.yaml",
      networkName: "daoflow-prod",
      imageReference: "ghcr.io/daoflow/control-plane:0.1.0",
      replicaCount: 2,
      releaseTrack: "stable",
      healthcheckPath: "/healthz"
    });
    expect(productionControlPlane?.dependencies).toEqual(["postgres", "redis"]);
    expect(productionControlPlane?.volumeMounts).toContain("/app/data");
  });

  it("returns compose drift planning surfaces for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-drift-viewer",
      session: makeSession("viewer")
    });

    const drift = await caller.composeDriftReport({});
    const productionControlPlane = drift.reports.find(
      (report) => report.composeServiceId === "compose_daoflow_prod_control_plane"
    );
    const stagingControlPlane = drift.reports.find(
      (report) => report.composeServiceId === "compose_daoflow_staging_control_plane"
    );

    expect(drift.summary).toEqual({
      totalServices: 5,
      alignedServices: 2,
      driftedServices: 2,
      blockedServices: 1,
      reviewRequired: 3
    });
    expect(productionControlPlane).toMatchObject({
      environmentName: "production-us-west",
      projectName: "DaoFlow",
      targetServerName: "foundation-vps-1",
      serviceName: "control-plane",
      status: "drifted",
      desiredImageReference: "ghcr.io/daoflow/control-plane:0.1.0",
      actualImageReference: "ghcr.io/daoflow/control-plane:0.1.0-rc1",
      desiredReplicaCount: 2,
      actualReplicaCount: 1,
      actualContainerState: "degraded"
    });
    expect(productionControlPlane?.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "Image"
        }),
        expect.objectContaining({
          field: "Replicas"
        }),
        expect.objectContaining({
          field: "Runtime state"
        })
      ])
    );
    expect(stagingControlPlane).toMatchObject({
      status: "blocked",
      actualReplicaCount: 0,
      actualContainerState: "crash-loop"
    });
  });

  it("returns approval queue state for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-approval-queue-viewer",
      session: makeSession("viewer")
    });

    const queue = await caller.approvalQueue({});
    const pendingRestore = queue.requests.find((request) => request.id === "approval_restore_prod_guard");

    expect(queue.summary).toEqual({
      totalRequests: 2,
      pendingRequests: 1,
      approvedRequests: 1,
      rejectedRequests: 0,
      criticalRequests: 1
    });
    expect(pendingRestore).toMatchObject({
      actionType: "backup-restore",
      resourceLabel: "postgres-volume@production-us-west",
      status: "pending",
      riskLevel: "critical",
      requestedBy: "planner-agent@daoflow.local",
      requestedByRole: "agent"
    });
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

  it("returns infrastructure inventory for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-inventory-viewer",
      session: makeSession("viewer")
    });

    const inventory = await caller.infrastructureInventory();
    const daoflowProject = inventory.projects.find((project) => project.name === "DaoFlow");
    const productionEnvironment = inventory.environments.find(
      (environment) => environment.id === "env_daoflow_production"
    );

    expect(inventory.summary).toEqual({
      totalServers: 1,
      totalProjects: 2,
      totalEnvironments: 3,
      healthyServers: 1
    });
    expect(inventory.servers[0]).toMatchObject({
      id: "srv_foundation_1",
      name: "foundation-vps-1",
      region: "us-west-2",
      sshPort: 22,
      engineVersion: "Docker Engine 28.0",
      status: "healthy",
      environmentCount: 3
    });
    expect(daoflowProject).toMatchObject({
      repositoryUrl: "https://github.com/daoflow/daoflow",
      defaultBranch: "main",
      serviceCount: 3,
      environmentCount: 2,
      latestDeploymentStatus: "healthy"
    });
    expect(productionEnvironment).toMatchObject({
      projectId: "proj_daoflow_control_plane",
      projectName: "DaoFlow",
      name: "production-us-west",
      targetServerName: "foundation-vps-1",
      networkName: "daoflow-prod",
      composeFilePath: "/srv/daoflow/production/compose.yaml",
      serviceCount: 3,
      status: "healthy"
    });
  });

  it("returns server readiness checks for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-server-readiness-viewer",
      session: makeSession("viewer")
    });

    const readiness = await caller.serverReadiness({});

    expect(readiness.summary).toEqual({
      totalServers: 1,
      readyServers: 1,
      attentionServers: 0,
      blockedServers: 0,
      averageLatencyMs: 24
    });
    expect(readiness.checks[0]).toMatchObject({
      serverId: "srv_foundation_1",
      serverName: "foundation-vps-1",
      serverHost: "10.0.0.14",
      targetKind: "docker-engine",
      serverStatus: "healthy",
      readinessStatus: "ready",
      sshPort: 22,
      sshReachable: true,
      dockerReachable: true,
      composeReachable: true,
      latencyMs: 24
    });
  });

  it("returns persistent volume inventory for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-volume-viewer",
      session: makeSession("viewer")
    });

    const inventory = await caller.persistentVolumes({});
    const protectedVolume = inventory.volumes.find(
      (volume) => volume.id === "pvol_daoflow_postgres_prod"
    );
    const unmanagedVolume = inventory.volumes.find(
      (volume) => volume.id === "pvol_daoflow_uploads_prod"
    );

    expect(inventory.summary).toEqual({
      totalVolumes: 3,
      protectedVolumes: 1,
      attentionVolumes: 2,
      attachedBytes: 4563402752
    });
    expect(protectedVolume).toMatchObject({
      environmentName: "production-us-west",
      projectName: "DaoFlow",
      targetServerName: "foundation-vps-1",
      serviceName: "postgres",
      volumeName: "daoflow_postgres_data",
      mountPath: "/var/lib/postgresql/data",
      backupPolicyId: "bpol_foundation_volume_daily",
      backupCoverage: "protected",
      restoreReadiness: "verified"
    });
    expect(unmanagedVolume).toMatchObject({
      serviceName: "control-plane",
      backupPolicyId: null,
      backupCoverage: "missing",
      restoreReadiness: "untested"
    });
  });

  it("returns evidence-backed deployment insights for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-insights-viewer",
      session: makeSession("viewer")
    });

    const insights = await caller.deploymentInsights({});
    const failedInsight = insights.find(
      (insight) => insight.deploymentId === "dep_foundation_20260311_1"
    );

    expect(insights.length).toBeGreaterThan(0);
    expect(failedInsight).toMatchObject({
      status: "failed",
      summary: "Health check failed and left the deployment unhealthy.",
      suspectedRootCause: "New container restarted twice and failed readiness checks."
    });
    expect(failedInsight?.safeActions[0]).toContain("healthy baseline");
    expect(failedInsight?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "step",
          id: "step_previous_health",
          title: "Health check"
        }),
        expect.objectContaining({
          kind: "event",
          id: "evt_foundation_previous_failed",
          title: "Deployment failed readiness checks."
        })
      ])
    );
    expect(failedInsight?.healthyBaseline).toMatchObject({
      deploymentId: "dep_foundation_20260312_1",
      commitSha: "03e40ca"
    });
  });

  it("returns rollback planning for failed and healthy deployments", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-rollback-viewer",
      session: makeSession("viewer")
    });

    const plans = await caller.deploymentRollbackPlans({});
    const failedPlan = plans.find((plan) => plan.deploymentId === "dep_foundation_20260311_1");
    const healthyPlan = plans.find((plan) => plan.deploymentId === "dep_foundation_20260312_1");

    expect(plans.length).toBeGreaterThan(0);
    expect(failedPlan).toMatchObject({
      currentStatus: "failed",
      isAvailable: true,
      targetDeploymentId: "dep_foundation_20260312_1",
      targetCommitSha: "03e40ca"
    });
    expect(failedPlan?.checks).toContain(
      "Confirm the rollback target still matches the desired environment variables and persistent volumes."
    );
    expect(failedPlan?.steps).toContain(
      "Replay environment variables and volume attachments from the rollback target snapshot."
    );
    expect(healthyPlan).toMatchObject({
      currentStatus: "healthy",
      isAvailable: false,
      targetDeploymentId: null,
      targetCommitSha: null,
      reason: "Current deployment is already healthy; rollback is not recommended."
    });
  });

  it("returns immutable audit entries for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-audit-viewer",
      session: makeSession("viewer")
    });

    const auditTrail = await caller.auditTrail({});

    expect(auditTrail.summary.totalEntries).toBeGreaterThan(0);
    expect(auditTrail.summary.deploymentActions).toBeGreaterThan(0);
    expect(auditTrail.entries[0]?.action).toBeTruthy();
    expect(auditTrail.entries.some((entry) => entry.action === "deployment.create")).toBe(true);
  });

  it("returns append-only deployment logs for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-logs-viewer",
      session: makeSession("viewer")
    });

    const logs = await caller.deploymentLogs({
      deploymentId: "dep_foundation_20260311_1"
    });

    expect(logs.summary.totalLines).toBeGreaterThan(0);
    expect(logs.summary.stderrLines).toBeGreaterThan(0);
    expect(logs.summary.deploymentCount).toBe(1);
    expect(logs.lines.some((line) => line.stream === "stderr")).toBe(true);
    expect(logs.lines.some((line) => line.message.includes("readiness probe"))).toBe(true);
  });

  it("returns redacted environment variable inventory for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-env-viewer",
      session: makeSession("viewer")
    });

    const inventory = await caller.environmentVariables({});
    const secretVariable = inventory.variables.find((variable) => variable.key === "POSTGRES_PASSWORD");
    const previewVariable = inventory.variables.find(
      (variable) => variable.key === "NEXT_PUBLIC_PREVIEW_MODE"
    );

    expect(inventory.summary).toEqual({
      totalVariables: 3,
      secretVariables: 1,
      runtimeVariables: 2,
      buildVariables: 1
    });
    expect(secretVariable).toMatchObject({
      environmentName: "production-us-west",
      displayValue: "[secret]",
      isSecret: true,
      category: "runtime"
    });
    expect(previewVariable).toMatchObject({
      displayValue: "true",
      branchPattern: "preview/*",
      category: "build"
    });
  });

  it("returns backup policies and runs for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backups-viewer",
      session: makeSession("viewer")
    });

    const overview = await caller.backupOverview({});

    expect(overview.policies.length).toBeGreaterThan(0);
    expect(overview.runs.length).toBeGreaterThan(0);
    expect(overview.summary.totalPolicies).toBeGreaterThan(0);
  });

  it("returns backup restore queue for signed-in viewers", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backup-restores-viewer",
      session: makeSession("viewer")
    });

    const restores = await caller.backupRestoreQueue({});

    expect(restores.summary).toEqual({
      totalRequests: 1,
      queuedRequests: 0,
      runningRequests: 0,
      succeededRequests: 1,
      failedRequests: 0
    });
    expect(restores.requests[0]).toMatchObject({
      backupRunId: "brun_foundation_volume_success",
      policyId: "bpol_foundation_volume_daily",
      projectName: "DaoFlow",
      environmentName: "production-us-west",
      serviceName: "postgres-volume",
      targetType: "volume",
      status: "succeeded",
      destinationServerName: "foundation-vps-1",
      sourceArtifactPath: "s3://daoflow-backups/prod/postgres-volume-2026-03-11.tar.zst",
      restorePath: "/var/lib/postgresql/data"
    });
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

  it("blocks compose release queueing for viewer roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-release-viewer-block",
      session: makeSession("viewer")
    });

    await expect(
      caller.queueComposeRelease({
        composeServiceId: "compose_daoflow_prod_control_plane",
        commitSha: "abcdef1"
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("blocks backup trigger mutations for viewer roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backups-viewer-block",
      session: makeSession("viewer")
    });

    await expect(
      caller.triggerBackupRun({
        policyId: "bpol_foundation_volume_daily"
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("blocks backup restore queueing for viewer roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-backup-restore-viewer-block",
      session: makeSession("viewer")
    });

    await expect(
      caller.queueBackupRestore({
        backupRunId: "brun_foundation_volume_success"
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("blocks approval requests for viewer roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-request-approval-viewer-block",
      session: makeSession("viewer")
    });

    await expect(
      caller.requestApproval({
        actionType: "compose-release",
        composeServiceId: "compose_daoflow_staging_control_plane",
        commitSha: "fedcba1",
        reason: "Need a second reviewer before promoting the next staging release."
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("blocks environment variable mutations for viewer roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-env-viewer-block",
      session: makeSession("viewer")
    });

    await expect(
      caller.upsertEnvironmentVariable({
        environmentId: "env_daoflow_staging",
        key: "VIEWER_BLOCKED",
        value: "true",
        isSecret: false,
        category: "runtime"
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("blocks server registration for viewer roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-server-register-viewer-block",
      session: makeSession("viewer")
    });

    await expect(
      caller.registerServer({
        name: "edge-vps-2",
        host: "10.0.2.15",
        region: "us-central-1",
        sshPort: 22,
        kind: "docker-engine"
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

  it("blocks principal inventory for non-admin roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-principal-viewer",
      session: makeSession("viewer")
    });

    await expect(caller.principalInventory()).rejects.toBeInstanceOf(TRPCError);
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

  it("returns principal inventory for elevated roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-principal-owner",
      session: makeSession("owner")
    });

    const response = await caller.principalInventory();
    const releaseService = response.principals.find(
      (principal) => principal.id === "principal_release_service_1"
    );
    const plannerAgent = response.principals.find(
      (principal) => principal.id === "principal_planner_agent_1"
    );
    const ownerPrincipal = response.principals.find((principal) => principal.id === "principal_owner_1");

    expect(response.summary).toEqual({
      totalPrincipals: 4,
      humanPrincipals: 1,
      serviceAccounts: 1,
      agentPrincipals: 2,
      commandCapablePrincipals: 2
    });
    expect(ownerPrincipal).toMatchObject({
      kind: "human",
      role: "owner",
      tokenCount: 0,
      highestLane: "none"
    });
    expect(releaseService).toMatchObject({
      kind: "service-account",
      role: "operator",
      tokenCount: 1,
      inactiveTokenCount: 1,
      highestLane: "command"
    });
    expect(plannerAgent).toMatchObject({
      kind: "agent",
      role: "agent",
      tokenCount: 1,
      activeTokenCount: 1,
      planningTokenCount: 1,
      highestLane: "planning"
    });
  });

  it("registers a new server and exposes blocked readiness for first contact", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-server-register-owner",
      session: makeSession("owner")
    });

    const server = await caller.registerServer({
      name: "edge-vps-2",
      host: "10.0.2.15",
      region: "us-central-1",
      sshPort: 2222,
      kind: "docker-engine"
    });

    expect(server).toMatchObject({
      serverName: "edge-vps-2",
      serverHost: "10.0.2.15",
      targetKind: "docker-engine",
      serverStatus: "degraded",
      readinessStatus: "blocked",
      sshPort: 2222,
      sshReachable: false,
      dockerReachable: false,
      composeReachable: false,
      latencyMs: null
    });
    expect(server?.issues).toContain("SSH handshake has not succeeded yet for this host.");

    const readiness = await caller.serverReadiness({});
    expect(readiness.summary.totalServers).toBeGreaterThanOrEqual(2);
    expect(readiness.summary.blockedServers).toBeGreaterThanOrEqual(1);
    expect(readiness.checks.some((check) => check.serverId === server?.serverId)).toBe(true);

    const inventory = await caller.infrastructureInventory();
    const registeredServer = inventory.servers.find((entry) => entry.id === server?.serverId);
    expect(registeredServer).toMatchObject({
      name: "edge-vps-2",
      host: "10.0.2.15",
      region: "us-central-1",
      sshPort: 2222,
      engineVersion: "pending verification",
      status: "degraded",
      environmentCount: 0
    });

    const auditTrail = await caller.auditTrail({ limit: 50 });
    expect(
      auditTrail.entries.some(
        (entry) =>
          entry.action === "server.register" &&
          entry.resourceType === "server" &&
          entry.resourceId === server?.serverId
      )
    ).toBe(true);
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

  it("queues compose release targets with topology-aware steps", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-release-queue",
      session: makeSession("developer")
    });

    const deployment = await caller.queueComposeRelease({
      composeServiceId: "compose_daoflow_prod_control_plane",
      commitSha: "abcdef1"
    });

    expect(deployment).toMatchObject({
      projectName: "DaoFlow",
      environmentName: "production-us-west",
      serviceName: "control-plane",
      sourceType: "compose",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/control-plane:0.1.0",
      requestedByEmail: "developer@daoflow.local",
      status: "queued"
    });
    expect(deployment.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Render compose target"
        }),
        expect.objectContaining({
          label: "Coordinate dependencies"
        }),
        expect.objectContaining({
          label: "Protect stateful mounts"
        })
      ])
    );

    const queue = await caller.executionQueue({
      status: "pending"
    });
    expect(queue.jobs.some((job) => job.deploymentId === deployment.id)).toBe(true);

    const details = await caller.deploymentDetails({
      deploymentId: deployment.id
    });
    expect(details.steps.some((step) => step.detail.includes("/srv/daoflow/production/compose.yaml"))).toBe(
      true
    );
    expect(details.steps.some((step) => step.detail.includes("postgres, redis"))).toBe(true);
  });

  it("creates guarded approval requests for compose releases", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-compose-release-approval-request",
      session: makeSession("developer")
    });

    const request = await caller.requestApproval({
      actionType: "compose-release",
      composeServiceId: "compose_daoflow_staging_control_plane",
      commitSha: "fedcba1",
      imageTag: "ghcr.io/daoflow/control-plane:staging-canary.3",
      reason: "Need operator approval before promoting the next staging canary release."
    });

    expect(request).toMatchObject({
      actionType: "compose-release",
      resourceLabel: "control-plane@staging",
      status: "pending",
      riskLevel: "critical",
      requestedBy: "developer@daoflow.local",
      requestedByRole: "developer"
    });

    const queue = await caller.approvalQueue({});
    expect(queue.summary.pendingRequests).toBeGreaterThanOrEqual(2);
    expect(queue.requests.some((entry) => entry.id === request.id)).toBe(true);
  });

  it("records audit entries for deployment, execution, and backup mutations", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-audit-mutations",
      session: makeSession("owner")
    });
    const before = await caller.auditTrail({
      limit: 50
    });

    const deployment = await caller.createDeploymentRecord({
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "audit-worker",
      sourceType: "dockerfile",
      targetServerId: "srv_foundation_1",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/audit-worker:0.3.0",
      steps: [
        {
          label: "Render runtime spec",
          detail: "Freeze the release inputs for audit-worker."
        }
      ]
    });

    const queue = await caller.executionQueue({
      status: "pending"
    });
    const job = queue.jobs.find((entry) => entry.deploymentId === deployment.id);

    expect(job).toBeDefined();
    if (!job) {
      throw new Error("Expected a queued execution job for the created deployment.");
    }

    await caller.dispatchExecutionJob({
      jobId: job.id
    });
    await caller.completeExecutionJob({
      jobId: job.id
    });
    await caller.triggerBackupRun({
      policyId: "bpol_foundation_volume_daily"
    });

    const after = await caller.auditTrail({
      limit: 50
    });
    const createdAudit = after.entries.find(
      (entry) => entry.action === "deployment.create" && entry.resourceId === deployment.id
    );
    const dispatchedAudit = after.entries.find(
      (entry) => entry.action === "execution.dispatch" && entry.resourceId === job.id
    );
    const completedAudit = after.entries.find(
      (entry) => entry.action === "execution.complete" && entry.resourceId === job.id
    );
    const backupAudit = after.entries.find((entry) => entry.action === "backup.trigger");

    expect(after.summary.totalEntries).toBeGreaterThan(before.summary.totalEntries);
    expect(createdAudit).toMatchObject({
      actorLabel: "owner@daoflow.local",
      actorRole: "owner",
      resourceLabel: "audit-worker@staging"
    });
    expect(dispatchedAudit?.detail).toContain("Dispatched the docker-ssh worker handoff");
    expect(completedAudit?.detail).toContain("Marked the rollout healthy");
    expect(backupAudit).toMatchObject({
      actorLabel: "owner@daoflow.local",
      actorRole: "owner",
      resourceType: "backup-policy"
    });
  });

  it("upserts environment variables with redacted reads and audit history", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-env-upsert",
      session: makeSession("developer")
    });
    const beforeAudit = await caller.auditTrail({
      limit: 50
    });

    const variable = await caller.upsertEnvironmentVariable({
      environmentId: "env_daoflow_staging",
      key: "INTERNAL_API_TOKEN",
      value: "super-secret-token",
      isSecret: true,
      category: "runtime",
      branchPattern: "feature/*"
    });

    expect(variable).toMatchObject({
      key: "INTERNAL_API_TOKEN",
      displayValue: "[secret]",
      isSecret: true,
      category: "runtime",
      branchPattern: "feature/*",
      updatedByEmail: "developer@daoflow.local"
    });

    const inventory = await caller.environmentVariables({
      environmentId: "env_daoflow_staging"
    });
    const inserted = inventory.variables.find((entry) => entry.id === variable.id);
    expect(inserted?.displayValue).toBe("[secret]");

    const afterAudit = await caller.auditTrail({
      limit: 50
    });
    const auditEntry = afterAudit.entries.find(
      (entry) => entry.action === "environment-variable.upsert" && entry.resourceId === variable.id
    );

    expect(afterAudit.summary.totalEntries).toBeGreaterThan(beforeAudit.summary.totalEntries);
    expect(auditEntry).toMatchObject({
      actorLabel: "developer@daoflow.local",
      actorRole: "developer",
      resourceLabel: "INTERNAL_API_TOKEN@staging",
      resourceType: "environment-variable"
    });
  });

  it("appends deployment logs during execution lifecycle transitions", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-logs-mutations",
      session: makeSession("operator")
    });

    const deployment = await caller.createDeploymentRecord({
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "log-worker",
      sourceType: "dockerfile",
      targetServerId: "srv_foundation_1",
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/log-worker:0.4.0",
      steps: [
        {
          label: "Render runtime spec",
          detail: "Prepare deployment logs for a staged rollout."
        }
      ]
    });

    const queue = await caller.executionQueue({
      status: "pending"
    });
    const job = queue.jobs.find((entry) => entry.deploymentId === deployment.id);

    expect(job).toBeDefined();
    if (!job) {
      throw new Error("Expected a queued execution job for the log-worker deployment.");
    }

    await caller.dispatchExecutionJob({
      jobId: job.id
    });
    await caller.completeExecutionJob({
      jobId: job.id
    });

    const logs = await caller.deploymentLogs({
      deploymentId: deployment.id,
      limit: 10
    });

    expect(logs.summary.totalLines).toBeGreaterThanOrEqual(3);
    expect(logs.lines.some((line) => line.message.includes("Control plane queued log-worker"))).toBe(
      true
    );
    expect(logs.lines.some((line) => line.message.includes("Worker claimed the queued job"))).toBe(
      true
    );
    expect(logs.lines.some((line) => line.message.includes("reported healthy"))).toBe(true);
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

  it("queues manual backup runs for operator roles", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-trigger-backup",
      session: makeSession("operator")
    });

    const run = await caller.triggerBackupRun({
      policyId: "bpol_foundation_volume_daily"
    });

    expect(run.status).toBe("queued");
    expect(run.requestedBy).toBe("operator@daoflow.local");

    const overview = await caller.backupOverview({});
    expect(overview.runs[0]?.id).toBe(run.id);
    expect(overview.summary.queuedRuns).toBeGreaterThanOrEqual(1);
  });

  it("queues restore drills from successful backup artifacts", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-queue-restore",
      session: makeSession("operator")
    });

    const restore = await caller.queueBackupRestore({
      backupRunId: "brun_foundation_volume_success"
    });

    expect(restore).toMatchObject({
      backupRunId: "brun_foundation_volume_success",
      status: "queued",
      requestedBy: "operator@daoflow.local",
      destinationServerName: "foundation-vps-1",
      restorePath: "/var/lib/postgresql/data"
    });
    expect(restore.validationSummary).toContain("smoke checks");

    const queue = await caller.backupRestoreQueue({});
    expect(queue.summary.queuedRequests).toBeGreaterThanOrEqual(1);
    expect(queue.requests.some((request) => request.id === restore.id)).toBe(true);

    const auditTrail = await caller.auditTrail({ limit: 50 });
    expect(
      auditTrail.entries.some(
        (entry) =>
          entry.action === "backup.restore.queue" &&
          entry.resourceType === "backup-run" &&
          entry.resourceId === "brun_foundation_volume_success"
      )
    ).toBe(true);
  });

  it("rejects restore drills for failed backup runs without artifacts", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-queue-restore-failed-run",
      session: makeSession("operator")
    });

    await expect(
      caller.queueBackupRestore({
        backupRunId: "brun_foundation_db_failed"
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Only successful backup runs with an artifact can be restored."
    });
  });

  it("approves guarded restore requests and executes the recovery drill", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-approve-restore-request",
      session: makeSession("operator")
    });

    const request = await caller.requestApproval({
      actionType: "backup-restore",
      backupRunId: "brun_foundation_volume_success",
      reason: "Need operator confirmation before replaying the latest production restore drill."
    });

    const approved = await caller.approveApprovalRequest({
      requestId: request.id
    });

    expect(approved).toMatchObject({
      id: request.id,
      status: "approved",
      decidedBy: "operator@daoflow.local",
      executionResourceType: "backup-restore"
    });

    const restores = await caller.backupRestoreQueue({});
    expect(
      restores.requests.some(
        (entry) =>
          entry.requestedBy === "operator@daoflow.local" &&
          entry.backupRunId === "brun_foundation_volume_success"
      )
    ).toBe(true);

    const auditTrail = await caller.auditTrail({ limit: 50 });
    expect(
      auditTrail.entries.some(
        (entry) =>
          entry.action === "approval.approve" &&
          entry.resourceType === "approval-request" &&
          entry.resourceId === request.id
      )
    ).toBe(true);
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
