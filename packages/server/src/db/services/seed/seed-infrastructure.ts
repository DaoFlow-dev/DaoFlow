import type { PgTransaction } from "drizzle-orm/pg-core";
import { encrypt } from "../../crypto";
import { servers } from "../../schema/servers";
import { projects, environments, environmentVariables } from "../../schema/projects";
import { volumes } from "../../schema/storage";
import { daysBefore, minutesBefore } from "./seed-helpers";

export async function seedInfrastructure(tx: PgTransaction<any, any, any>) {
  await tx
    .insert(servers)
    .values({
      id: "srv_foundation_1",
      name: "foundation-vps-1",
      host: "203.0.113.24",
      region: "us-west-2",
      sshPort: 22,
      kind: "docker-engine",
      status: "ready",
      dockerVersion: "Docker Engine 28.0",
      metadata: {
        readinessCheck: {
          id: "srvcheck_foundation_ready",
          readinessStatus: "ready",
          sshReachable: true,
          dockerReachable: true,
          composeReachable: true,
          latencyMs: 24,
          checkedAt: minutesBefore(1).toISOString(),
          issues: [],
          recommendedActions: [
            "Keep Docker Engine patched and rerun readiness probes after host maintenance."
          ]
        }
      },
      registeredByUserId: "user_foundation_owner",
      lastCheckedAt: minutesBefore(1),
      createdAt: daysBefore(45),
      updatedAt: minutesBefore(1)
    })
    .onConflictDoNothing();

  await tx
    .insert(projects)
    .values([
      {
        id: "proj_daoflow_control_plane",
        name: "DaoFlow",
        slug: "daoflow",
        teamId: "team_foundation",
        repoFullName: "daoflow/daoflow",
        repoUrl: "https://github.com/daoflow/daoflow",
        sourceType: "compose",
        composePath: "/srv/daoflow/production/compose.yaml",
        config: {
          defaultBranch: "main",
          serviceCount: 3,
          environmentCount: 2,
          latestDeploymentStatus: "healthy"
        },
        createdByUserId: "user_foundation_owner",
        createdAt: daysBefore(45),
        updatedAt: daysBefore(2)
      },
      {
        id: "proj_agent_bridge",
        name: "Agent Bridge",
        slug: "agent-bridge",
        teamId: "team_foundation",
        repoFullName: "daoflow/agent-bridge",
        repoUrl: "https://github.com/daoflow/agent-bridge",
        sourceType: "compose",
        composePath: "/srv/agent-bridge/lab/compose.yaml",
        config: {
          defaultBranch: "main",
          serviceCount: 2,
          environmentCount: 1,
          latestDeploymentStatus: "failed"
        },
        createdByUserId: "user_foundation_owner",
        createdAt: daysBefore(32),
        updatedAt: daysBefore(2)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(environments)
    .values([
      {
        id: "env_daoflow_production",
        name: "production-us-west",
        slug: "production-us-west",
        projectId: "proj_daoflow_control_plane",
        status: "healthy",
        config: {
          projectName: "DaoFlow",
          targetServerId: "srv_foundation_1",
          targetServerName: "foundation-vps-1",
          networkName: "daoflow-prod",
          composeFilePath: "/srv/daoflow/production/compose.yaml",
          serviceCount: 3,
          composeServices: [
            {
              id: "compose_daoflow_prod_control_plane",
              serviceName: "control-plane",
              imageReference: "ghcr.io/daoflow/control-plane:0.1.0",
              replicaCount: 2,
              exposedPorts: ["3000:3000"],
              dependencies: ["postgres", "redis"],
              volumeMounts: ["/app/data"],
              healthcheckPath: "/healthz",
              releaseTrack: "stable"
            },
            {
              id: "compose_daoflow_prod_worker",
              serviceName: "worker",
              imageReference: "ghcr.io/daoflow/worker:0.1.0",
              replicaCount: 1,
              exposedPorts: [],
              dependencies: ["control-plane", "postgres"],
              volumeMounts: ["/var/run/docker.sock"],
              healthcheckPath: null,
              releaseTrack: "stable"
            },
            {
              id: "compose_daoflow_prod_postgres",
              serviceName: "postgres",
              imageReference: "postgres:16-alpine",
              replicaCount: 1,
              exposedPorts: ["5432:5432"],
              dependencies: [],
              volumeMounts: ["/var/lib/postgresql/data"],
              healthcheckPath: null,
              releaseTrack: "stable"
            }
          ],
          composeDriftReports: [
            {
              composeServiceId: "compose_daoflow_prod_control_plane",
              serviceName: "control-plane",
              status: "drifted",
              summary:
                "Production control-plane is serving a release-candidate image and one replica is missing.",
              impactSummary:
                "Traffic is still flowing, but runtime state no longer matches the catalogued stable rollout.",
              desiredImageReference: "ghcr.io/daoflow/control-plane:0.1.0",
              actualImageReference: "ghcr.io/daoflow/control-plane:0.1.0-rc1",
              desiredReplicaCount: 2,
              actualReplicaCount: 1,
              actualContainerState: "degraded",
              lastCheckedAt: minutesBefore(3).toISOString(),
              recommendedActions: [
                "Compare the running spec with the last healthy deployment before queuing another release.",
                "Only scale the missing replica after the release-candidate image passes readiness in isolation."
              ],
              diffs: [
                {
                  id: "cdrift_diff_control_plane_image",
                  field: "image",
                  desiredValue: "ghcr.io/daoflow/control-plane:0.1.0",
                  actualValue: "ghcr.io/daoflow/control-plane:0.1.0-rc1",
                  impact:
                    "Operators are no longer looking at the image pinned in the release catalog."
                },
                {
                  id: "cdrift_diff_control_plane_replicas",
                  field: "replicas",
                  desiredValue: "2",
                  actualValue: "1",
                  impact: "Capacity is degraded and a single process now carries all traffic."
                }
              ]
            }
          ]
        },
        createdAt: daysBefore(30),
        updatedAt: minutesBefore(3)
      },
      {
        id: "env_daoflow_staging",
        name: "staging",
        slug: "staging",
        projectId: "proj_daoflow_control_plane",
        status: "queued",
        config: {
          projectName: "DaoFlow",
          targetServerId: "srv_foundation_1",
          targetServerName: "foundation-vps-1",
          networkName: "daoflow-staging",
          composeFilePath: "/srv/daoflow/staging/compose.yaml",
          serviceCount: 1,
          composeServices: [
            {
              id: "compose_daoflow_staging_control_plane",
              serviceName: "control-plane",
              imageReference: "ghcr.io/daoflow/control-plane:staging",
              replicaCount: 1,
              exposedPorts: ["3001:3000"],
              dependencies: ["postgres"],
              volumeMounts: ["/app/data"],
              healthcheckPath: "/healthz",
              releaseTrack: "canary"
            }
          ],
          composeDriftReports: [
            {
              composeServiceId: "compose_daoflow_staging_control_plane",
              serviceName: "control-plane",
              status: "blocked",
              summary:
                "Staging never converged to the desired canary spec after the last rollout attempt.",
              impactSummary:
                "No healthy staging control-plane task is currently serving the desired release.",
              desiredImageReference: "ghcr.io/daoflow/control-plane:staging",
              actualImageReference: "ghcr.io/daoflow/control-plane:0.0.9",
              desiredReplicaCount: 1,
              actualReplicaCount: 0,
              actualContainerState: "crash-loop",
              lastCheckedAt: minutesBefore(9).toISOString(),
              recommendedActions: [
                "Inspect the last failed deployment logs before attempting another canary rollout.",
                "Restore the healthcheck contract before re-enabling automated staging promotions."
              ],
              diffs: [
                {
                  id: "cdrift_diff_staging_image",
                  field: "image",
                  desiredValue: "ghcr.io/daoflow/control-plane:staging",
                  actualValue: "ghcr.io/daoflow/control-plane:0.0.9",
                  impact:
                    "The environment is pinned to an image that predates the tracked canary release."
                },
                {
                  id: "cdrift_diff_staging_healthcheck",
                  field: "healthcheck",
                  desiredValue: "/healthz",
                  actualValue: "missing",
                  impact:
                    "The worker cannot verify readiness, so automated promotion stays blocked."
                }
              ]
            }
          ]
        },
        createdAt: daysBefore(24),
        updatedAt: minutesBefore(9)
      },
      {
        id: "env_agent_bridge_lab",
        name: "lab",
        slug: "lab",
        projectId: "proj_agent_bridge",
        status: "failed",
        config: {
          projectName: "Agent Bridge",
          targetServerId: "srv_foundation_1",
          targetServerName: "foundation-vps-1",
          networkName: "agent-bridge-lab",
          composeFilePath: "/srv/agent-bridge/lab/compose.yaml",
          serviceCount: 1,
          composeServices: [
            {
              id: "compose_agent_bridge_lab_runtime",
              serviceName: "agent-runtime",
              imageReference: "ghcr.io/daoflow/agent-runtime:0.5.0",
              replicaCount: 1,
              exposedPorts: ["8080:8080"],
              dependencies: ["session-store"],
              volumeMounts: ["/var/lib/agent-bridge/sessions"],
              healthcheckPath: "/ready",
              releaseTrack: "canary"
            }
          ],
          composeDriftReports: [
            {
              composeServiceId: "compose_agent_bridge_lab_runtime",
              serviceName: "agent-runtime",
              status: "drifted",
              summary:
                "Lab agent runtime is running an older image and lost its persistent session mount.",
              impactSummary:
                "Agent sessions may look healthy briefly but are not durable across restarts.",
              desiredImageReference: "ghcr.io/daoflow/agent-runtime:0.5.0",
              actualImageReference: "ghcr.io/daoflow/agent-runtime:0.4.8",
              desiredReplicaCount: 1,
              actualReplicaCount: 1,
              actualContainerState: "running-with-warnings",
              lastCheckedAt: minutesBefore(7).toISOString(),
              recommendedActions: [
                "Reattach the missing session volume before promoting any agent workflow changes.",
                "Plan a controlled image update because the runtime is behind the tracked catalog version."
              ],
              diffs: [
                {
                  id: "cdrift_diff_agent_runtime_image",
                  field: "image",
                  desiredValue: "ghcr.io/daoflow/agent-runtime:0.5.0",
                  actualValue: "ghcr.io/daoflow/agent-runtime:0.4.8",
                  impact: "Runtime behavior may diverge from the catalogued lab validation plan."
                },
                {
                  id: "cdrift_diff_agent_runtime_volume",
                  field: "volumeMounts",
                  desiredValue: "/var/lib/agent-bridge/sessions",
                  actualValue: "none",
                  impact: "Session state is no longer durable across restarts."
                }
              ]
            }
          ]
        },
        createdAt: daysBefore(20),
        updatedAt: minutesBefore(7)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(volumes)
    .values([
      {
        id: "pvol_daoflow_postgres_prod",
        name: "daoflow_postgres_data",
        serverId: "srv_foundation_1",
        mountPath: "/var/lib/postgresql/data",
        sizeBytes: "3221225472",
        status: "active",
        metadata: {
          projectName: "DaoFlow",
          environmentId: "env_daoflow_production",
          environmentName: "production-us-west",
          targetServerName: "foundation-vps-1",
          serviceName: "postgres",
          driver: "local",
          backupPolicyId: "bpol_foundation_volume_daily",
          backupCoverage: "protected",
          restoreReadiness: "verified",
          lastBackupAt: daysBefore(1).toISOString(),
          lastRestoreTestAt: daysBefore(2).toISOString()
        },
        createdAt: daysBefore(30),
        updatedAt: minutesBefore(5)
      },
      {
        id: "pvol_daoflow_uploads_prod",
        name: "daoflow_upload_cache",
        serverId: "srv_foundation_1",
        mountPath: "/app/data/uploads",
        sizeBytes: "536870912",
        status: "active",
        metadata: {
          projectName: "DaoFlow",
          environmentId: "env_daoflow_production",
          environmentName: "production-us-west",
          targetServerName: "foundation-vps-1",
          serviceName: "control-plane",
          driver: "local",
          backupPolicyId: null,
          backupCoverage: "missing",
          restoreReadiness: "untested",
          lastBackupAt: null,
          lastRestoreTestAt: null
        },
        createdAt: daysBefore(30),
        updatedAt: minutesBefore(12)
      },
      {
        id: "pvol_agent_bridge_sessions_lab",
        name: "agent_bridge_sessions",
        serverId: "srv_foundation_1",
        mountPath: "/var/lib/agent-bridge/sessions",
        sizeBytes: "805306368",
        status: "active",
        metadata: {
          projectName: "Agent Bridge",
          environmentId: "env_agent_bridge_lab",
          environmentName: "lab",
          targetServerName: "foundation-vps-1",
          serviceName: "agent-runtime",
          driver: "local",
          backupPolicyId: null,
          backupCoverage: "missing",
          restoreReadiness: "untested",
          lastBackupAt: null,
          lastRestoreTestAt: null
        },
        createdAt: daysBefore(20),
        updatedAt: minutesBefore(14)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(environmentVariables)
    .values([
      {
        id: 1001,
        environmentId: "env_daoflow_production",
        key: "APP_BASE_URL",
        valueEncrypted: encrypt("https://daoflow.example.com"),
        isSecret: "false",
        category: "runtime",
        branchPattern: null,
        updatedByUserId: "user_foundation_owner",
        createdAt: daysBefore(9),
        updatedAt: daysBefore(9)
      },
      {
        id: 1002,
        environmentId: "env_daoflow_production",
        key: "POSTGRES_PASSWORD",
        valueEncrypted: encrypt("prod-super-secret-password"),
        isSecret: "true",
        category: "runtime",
        branchPattern: null,
        updatedByUserId: "user_foundation_owner",
        createdAt: daysBefore(7),
        updatedAt: daysBefore(7)
      },
      {
        id: 1003,
        environmentId: "env_daoflow_staging",
        key: "NEXT_PUBLIC_PREVIEW_MODE",
        valueEncrypted: encrypt("true"),
        isSecret: "false",
        category: "build",
        branchPattern: "preview/*",
        updatedByUserId: "user_foundation_owner",
        createdAt: daysBefore(4),
        updatedAt: daysBefore(4)
      }
    ])
    .onConflictDoNothing();
}
