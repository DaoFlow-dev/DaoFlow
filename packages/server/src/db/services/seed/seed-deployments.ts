import { deployments, deploymentSteps, deploymentLogs } from "../../schema/deployments";
import { minutesBefore } from "./seed-helpers";
import type { SeedTransaction } from "./seed-types";

export async function seedDeployments(tx: SeedTransaction) {
  await tx
    .insert(deployments)
    .values([
      {
        id: "dep_foundation_20260312_1",
        projectId: "proj_daoflow_control_plane",
        environmentId: "env_daoflow_production",
        targetServerId: "srv_foundation_1",
        serviceName: "control-plane",
        sourceType: "compose",
        commitSha: "03e40ca",
        imageTag: "ghcr.io/daoflow/control-plane:0.1.0",
        configSnapshot: {
          projectName: "DaoFlow",
          environmentName: "production-us-west",
          targetServerName: "foundation-vps-1",
          targetServerHost: "203.0.113.24",
          queueName: "docker-ssh",
          workerHint: "ssh://foundation-vps-1/docker-engine",
          executionJobId: "job_foundation_20260312_1"
        },
        status: "completed",
        conclusion: "succeeded",
        trigger: "user",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner",
        containerId: "ctr_foundation_prod_cp",
        error: null,
        createdAt: minutesBefore(7),
        concludedAt: minutesBefore(1.5),
        updatedAt: minutesBefore(1.5)
      },
      {
        id: "dep_foundation_20260311_1",
        projectId: "proj_daoflow_control_plane",
        environmentId: "env_daoflow_production",
        targetServerId: "srv_foundation_1",
        serviceName: "control-plane",
        sourceType: "compose",
        commitSha: "9bc1d22",
        imageTag: "ghcr.io/daoflow/control-plane:0.1.0-rc1",
        configSnapshot: {
          projectName: "DaoFlow",
          environmentName: "production-us-west",
          targetServerName: "foundation-vps-1",
          targetServerHost: "203.0.113.24",
          queueName: "docker-ssh",
          workerHint: "ssh://foundation-vps-1/docker-engine",
          executionJobId: "job_foundation_20260311_1",
          insight: {
            summary: "Health check failed and left the deployment unhealthy.",
            suspectedRootCause:
              "Readiness endpoint /healthz returned 503 for 2 consecutive checks.",
            safeActions: [
              "Compare this release candidate against the last healthy baseline before retrying.",
              "Inspect the readiness contract and container exit code before promoting another build."
            ],
            evidence: [
              {
                kind: "log",
                id: "log_foundation_failed_2",
                title: "stderr#2",
                detail: "Container exited with code 1 during readiness probe."
              },
              {
                kind: "log",
                id: "log_foundation_failed_3",
                title: "stderr#3",
                detail: "Readiness endpoint /healthz returned 503 for 2 consecutive checks."
              }
            ],
            healthyBaseline: {
              deploymentId: "dep_foundation_20260312_1",
              commitSha: "03e40ca",
              imageTag: "ghcr.io/daoflow/control-plane:0.1.0",
              finishedAt: minutesBefore(1.5).toISOString()
            }
          },
          rollbackPlan: {
            isAvailable: true,
            reason:
              "The last healthy deployment is still available as a deterministic rollback target.",
            targetDeploymentId: "dep_foundation_20260312_1",
            targetCommitSha: "03e40ca",
            targetImageTag: "ghcr.io/daoflow/control-plane:0.1.0",
            checks: [
              "Verify the target server is still reachable before issuing rollback commands.",
              "Confirm the production postgres volume is not replaying a restore before swapping containers."
            ],
            steps: [
              "Replay environment variables and volume attachments from the rollback target snapshot.",
              "Start the stable control-plane image and hold traffic until /healthz stays green."
            ]
          }
        },
        status: "failed",
        conclusion: "failed",
        trigger: "user",
        requestedByUserId: "user_foundation_owner",
        requestedByEmail: "owner@daoflow.local",
        requestedByRole: "owner",
        containerId: "ctr_foundation_prod_cp_rc1",
        error: {
          message: "Health check failed and left the deployment unhealthy.",
          suspectedRootCause: "Readiness endpoint /healthz returned 503 for 2 consecutive checks."
        },
        createdAt: minutesBefore(70),
        concludedAt: minutesBefore(66),
        updatedAt: minutesBefore(66)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(deploymentSteps)
    .values([
      {
        id: 2001,
        deploymentId: "dep_foundation_20260312_1",
        label: "Resolve compose spec",
        detail: "Rendered compose overlays for production-us-west.",
        status: "completed",
        startedAt: minutesBefore(6),
        completedAt: minutesBefore(5),
        sortOrder: 1
      },
      {
        id: 2002,
        deploymentId: "dep_foundation_20260312_1",
        label: "Pull image",
        detail: "Pulled ghcr.io/daoflow/control-plane:0.1.0.",
        status: "completed",
        startedAt: minutesBefore(5),
        completedAt: minutesBefore(3),
        sortOrder: 2
      },
      {
        id: 2003,
        deploymentId: "dep_foundation_20260312_1",
        label: "Health check",
        detail: "HTTP health probe stayed healthy for 90 seconds.",
        status: "completed",
        startedAt: minutesBefore(2),
        completedAt: minutesBefore(1.5),
        sortOrder: 3
      },
      {
        id: 2004,
        deploymentId: "dep_foundation_20260311_1",
        label: "Resolve compose spec",
        detail: "Rendered compose overlays for production-us-west.",
        status: "completed",
        startedAt: minutesBefore(69),
        completedAt: minutesBefore(68),
        sortOrder: 4
      },
      {
        id: 2005,
        deploymentId: "dep_foundation_20260311_1",
        label: "Pull image",
        detail: "Pulled ghcr.io/daoflow/control-plane:0.1.0-rc1.",
        status: "completed",
        startedAt: minutesBefore(68),
        completedAt: minutesBefore(67),
        sortOrder: 5
      },
      {
        id: 2006,
        deploymentId: "dep_foundation_20260311_1",
        label: "Health check",
        detail: "Readiness probe failed twice and the rollout was marked unhealthy.",
        status: "failed",
        startedAt: minutesBefore(67),
        completedAt: minutesBefore(66),
        sortOrder: 6
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(deploymentLogs)
    .values([
      {
        id: 3001,
        deploymentId: "dep_foundation_20260312_1",
        level: "info",
        message: "Resolved compose overlays for production-us-west.",
        source: "system",
        metadata: { seedId: "log_foundation_healthy_1", stream: "stdout", lineNumber: 1 },
        createdAt: minutesBefore(6)
      },
      {
        id: 3002,
        deploymentId: "dep_foundation_20260312_1",
        level: "info",
        message: "Pulled ghcr.io/daoflow/control-plane:0.1.0 from registry cache.",
        source: "runtime",
        metadata: { seedId: "log_foundation_healthy_2", stream: "stdout", lineNumber: 2 },
        createdAt: minutesBefore(5)
      },
      {
        id: 3003,
        deploymentId: "dep_foundation_20260312_1",
        level: "info",
        message: "Health probe stayed green for 90 seconds.",
        source: "runtime",
        metadata: { seedId: "log_foundation_healthy_3", stream: "stdout", lineNumber: 3 },
        createdAt: minutesBefore(1.5)
      },
      {
        id: 3004,
        deploymentId: "dep_foundation_20260311_1",
        level: "info",
        message: "Pulled ghcr.io/daoflow/control-plane:0.1.0-rc1.",
        source: "runtime",
        metadata: { seedId: "log_foundation_failed_1", stream: "stdout", lineNumber: 1 },
        createdAt: minutesBefore(69)
      },
      {
        id: 3005,
        deploymentId: "dep_foundation_20260311_1",
        level: "error",
        message: "Container exited with code 1 during readiness probe.",
        source: "runtime",
        metadata: { seedId: "log_foundation_failed_2", stream: "stderr", lineNumber: 2 },
        createdAt: minutesBefore(67)
      },
      {
        id: 3006,
        deploymentId: "dep_foundation_20260311_1",
        level: "error",
        message: "Readiness endpoint /healthz returned 503 for 2 consecutive checks.",
        source: "runtime",
        metadata: { seedId: "log_foundation_failed_3", stream: "stderr", lineNumber: 3 },
        createdAt: minutesBefore(66)
      }
    ])
    .onConflictDoNothing();
}
