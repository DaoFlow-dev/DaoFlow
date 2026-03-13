import { db } from "../connection";
import { encrypt } from "../crypto";
import { approvalRequests, auditEntries, events } from "../schema/audit";
import { backupPolicies, backupRestores, backupRuns, volumes } from "../schema/storage";
import { deployments, deploymentLogs, deploymentSteps } from "../schema/deployments";
import { environmentVariables, environments, projects } from "../schema/projects";
import { apiTokens, principals } from "../schema/tokens";
import { servers } from "../schema/servers";
import { teamMembers, teams } from "../schema/teams";
import { users } from "../schema/users";

const FOUNDATION_REFERENCE_TIME = new Date("2026-03-12T18:45:00.000Z");

function daysBefore(days: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() - days * 24 * 60 * 60 * 1000);
}

function hoursBefore(hours: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() - hours * 60 * 60 * 1000);
}

function minutesBefore(minutes: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() - minutes * 60 * 1000);
}

function hoursAfter(hours: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() + hours * 60 * 60 * 1000);
}

function _minutesAfter(minutes: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() + minutes * 60 * 1000);
}

export async function seedControlPlaneData() {
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values([
        {
          id: "user_foundation_owner",
          email: "owner@daoflow.local",
          name: "Foundation Owner",
          username: "foundation-owner",
          emailVerified: true,
          role: "owner",
          status: "active",
          createdAt: daysBefore(30),
          updatedAt: minutesBefore(2)
        },
        {
          id: "user_foundation_operator",
          email: "operator@daoflow.local",
          name: "Foundation Operator",
          username: "foundation-operator",
          emailVerified: true,
          role: "operator",
          status: "active",
          createdAt: daysBefore(28),
          updatedAt: daysBefore(1)
        },
        {
          id: "user_developer",
          email: "developer@daoflow.local",
          name: "Foundation Developer",
          username: "foundation-developer",
          emailVerified: true,
          role: "developer",
          status: "active",
          createdAt: daysBefore(21),
          updatedAt: daysBefore(1)
        },
        {
          id: "user_observer_agent",
          email: "observer-agent@daoflow.local",
          name: "Observer Agent",
          username: "observer-agent",
          emailVerified: true,
          role: "agent",
          status: "active",
          createdAt: daysBefore(18),
          updatedAt: hoursBefore(8)
        },
        {
          id: "user_planner_agent",
          email: "planner-agent@daoflow.local",
          name: "Planner Agent",
          username: "planner-agent",
          emailVerified: true,
          role: "agent",
          status: "active",
          createdAt: daysBefore(14),
          updatedAt: hoursBefore(2)
        }
      ])
      .onConflictDoNothing();

    await tx
      .insert(teams)
      .values({
        id: "team_foundation",
        name: "Foundation Team",
        slug: "foundation",
        status: "active",
        createdByUserId: "user_foundation_owner",
        createdAt: daysBefore(30),
        updatedAt: daysBefore(30)
      })
      .onConflictDoNothing();

    await tx
      .insert(teamMembers)
      .values([
        {
          id: 7001,
          teamId: "team_foundation",
          userId: "user_foundation_owner",
          role: "owner",
          createdAt: daysBefore(30)
        },
        {
          id: 7002,
          teamId: "team_foundation",
          userId: "user_foundation_operator",
          role: "admin",
          createdAt: daysBefore(28)
        },
        {
          id: 7003,
          teamId: "team_foundation",
          userId: "user_developer",
          role: "member",
          createdAt: daysBefore(21)
        }
      ])
      .onConflictDoNothing();

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
      .insert(backupPolicies)
      .values([
        {
          id: "bpol_foundation_volume_daily",
          name: "postgres-volume",
          volumeId: "pvol_daoflow_postgres_prod",
          schedule: "Daily at 02:00 UTC",
          retentionDays: 14,
          storageTarget: "s3://daoflow-backups/prod",
          status: "active",
          createdAt: daysBefore(12),
          updatedAt: daysBefore(1)
        },
        {
          id: "bpol_foundation_db_hourly",
          name: "control-plane-db",
          volumeId: "pvol_daoflow_postgres_prod",
          schedule: "Hourly",
          retentionDays: 48,
          storageTarget: "s3://daoflow-backups/staging",
          status: "active",
          createdAt: daysBefore(11),
          updatedAt: hoursBefore(1)
        }
      ])
      .onConflictDoNothing();

    await tx
      .insert(backupRuns)
      .values([
        {
          id: "brun_foundation_volume_success",
          policyId: "bpol_foundation_volume_daily",
          status: "succeeded",
          artifactPath: "s3://daoflow-backups/prod/postgres-volume-2026-03-11.tar.zst",
          sizeBytes: "73400320",
          triggeredByUserId: null,
          error: null,
          startedAt: daysBefore(1),
          completedAt: new Date(daysBefore(1).getTime() + 5 * 60 * 1000),
          createdAt: daysBefore(1)
        },
        {
          id: "brun_foundation_db_failed",
          policyId: "bpol_foundation_db_hourly",
          status: "failed",
          artifactPath: null,
          sizeBytes: null,
          triggeredByUserId: null,
          error: "pg_dump lost the SSH transport before the archive uploaded.",
          startedAt: hoursBefore(1),
          completedAt: new Date(hoursBefore(1).getTime() + 7 * 60 * 1000),
          createdAt: hoursBefore(1)
        }
      ])
      .onConflictDoNothing();

    await tx
      .insert(backupRestores)
      .values({
        id: "brestore_foundation_volume_verify",
        backupRunId: "brun_foundation_volume_success",
        status: "succeeded",
        targetPath: "/var/lib/postgresql/data",
        triggeredByUserId: "user_foundation_operator",
        error: "Restore drill replayed the volume snapshot and passed the smoke query check.",
        startedAt: new Date(daysBefore(2).getTime() - 20 * 60 * 1000),
        completedAt: daysBefore(2),
        createdAt: new Date(daysBefore(2).getTime() - 20 * 60 * 1000)
      })
      .onConflictDoNothing();

    await tx
      .insert(principals)
      .values([
        {
          id: "principal_observer_agent_1",
          type: "agent",
          name: "observer-agent",
          description: "Read-only deployment observer.",
          linkedUserId: "user_observer_agent",
          defaultScopes: "read.projects,read.deployments,read.logs",
          status: "active",
          createdAt: daysBefore(12),
          updatedAt: daysBefore(12)
        },
        {
          id: "principal_planner_agent_1",
          type: "agent",
          name: "planner-agent",
          description: "Planning-only automation identity.",
          linkedUserId: "user_planner_agent",
          defaultScopes: "read.projects,read.deployments,read.logs,agents.plan",
          status: "active",
          createdAt: daysBefore(5),
          updatedAt: daysBefore(5)
        },
        {
          id: "principal_release_service_1",
          type: "service",
          name: "release-service",
          description: "Paused command-capable release automation.",
          linkedUserId: null,
          defaultScopes: "read.projects,read.deployments,read.logs,agents.plan,deploy.execute",
          status: "paused",
          createdAt: daysBefore(16),
          updatedAt: daysBefore(16)
        }
      ])
      .onConflictDoNothing();

    await tx
      .insert(apiTokens)
      .values([
        {
          id: "token_observer_readonly",
          name: "readonly-observer",
          tokenHash: "seed_token_hash_observer_readonly",
          tokenPrefix: "df_read_4f39",
          principalType: "agent",
          principalId: "principal_observer_agent_1",
          scopes: "read.projects,read.deployments,read.logs",
          status: "active",
          lastUsedAt: minutesBefore(6),
          expiresAt: null,
          createdByUserId: "user_foundation_owner",
          createdAt: daysBefore(12),
          revokedAt: null
        },
        {
          id: "token_planner_agent",
          name: "planner-agent",
          tokenHash: "seed_token_hash_planner_agent",
          tokenPrefix: "df_plan_7ab2",
          principalType: "agent",
          principalId: "principal_planner_agent_1",
          scopes: "read.projects,read.deployments,read.logs,agents.plan",
          status: "active",
          lastUsedAt: hoursBefore(2),
          expiresAt: daysBefore(-25),
          createdByUserId: "user_foundation_owner",
          createdAt: daysBefore(5),
          revokedAt: null
        },
        {
          id: "token_release_service",
          name: "release-service",
          tokenHash: "seed_token_hash_release_service",
          tokenPrefix: "df_cmd_2cd8",
          principalType: "service",
          principalId: "principal_release_service_1",
          scopes: "read.projects,read.deployments,read.logs,agents.plan,deploy.execute",
          status: "paused",
          lastUsedAt: hoursBefore(19),
          expiresAt: null,
          createdByUserId: "user_foundation_owner",
          createdAt: daysBefore(16),
          revokedAt: null
        }
      ])
      .onConflictDoNothing();

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

    await tx
      .insert(auditEntries)
      .values([
        {
          id: 4001,
          actorType: "user",
          actorId: "user_foundation_owner",
          actorEmail: "owner@daoflow.local",
          actorRole: "owner",
          organizationId: "team_foundation",
          targetResource: "deployment/dep_foundation_20260312_1",
          action: "deployment.create",
          inputSummary: "Queued the seeded control-plane rollout for production-us-west.",
          permissionScope: "deploy:start",
          outcome: "success",
          metadata: {
            seedId: "audit_foundation_deployment_create",
            resourceType: "deployment",
            resourceId: "dep_foundation_20260312_1",
            resourceLabel: "control-plane@production-us-west",
            detail: "Queued the seeded control-plane rollout for production-us-west."
          },
          createdAt: minutesBefore(7)
        },
        {
          id: 4002,
          actorType: "user",
          actorId: "user_foundation_owner",
          actorEmail: "owner@daoflow.local",
          actorRole: "owner",
          organizationId: "team_foundation",
          targetResource: "execution-job/job_foundation_20260312_1",
          action: "execution.complete",
          inputSummary: "Marked the seeded production rollout healthy after worker completion.",
          permissionScope: "deploy:start",
          outcome: "success",
          metadata: {
            seedId: "audit_foundation_execution_complete",
            resourceType: "execution-job",
            resourceId: "job_foundation_20260312_1",
            resourceLabel: "control-plane@production-us-west",
            detail: "Marked the seeded production rollout healthy after worker completion."
          },
          createdAt: minutesBefore(1.5)
        },
        {
          id: 4003,
          actorType: "system",
          actorId: "scheduler",
          actorEmail: null,
          actorRole: null,
          organizationId: "team_foundation",
          targetResource: "backup-run/brun_foundation_volume_success",
          action: "backup.schedule",
          inputSummary:
            "Recorded the scheduled volume backup snapshot for the production database volume.",
          permissionScope: "backup:run",
          outcome: "success",
          metadata: {
            seedId: "audit_foundation_backup_schedule",
            resourceType: "backup-run",
            resourceId: "brun_foundation_volume_success",
            resourceLabel: "postgres-volume@production-us-west",
            detail:
              "Recorded the scheduled volume backup snapshot for the production database volume."
          },
          createdAt: new Date(daysBefore(1).getTime() + 5 * 60 * 1000)
        }
      ])
      .onConflictDoNothing();

    await tx
      .insert(events)
      .values([
        {
          id: 5001,
          kind: "execution.job.created",
          resourceType: "deployment",
          resourceId: "dep_foundation_20260312_1",
          summary: "Prepared SSH-backed execution handoff.",
          detail: "The deployment was packaged for the docker-ssh worker queue.",
          severity: "info",
          metadata: {
            serviceName: "control-plane",
            actorLabel: "control-plane"
          },
          createdAt: minutesBefore(7)
        },
        {
          id: 5002,
          kind: "deployment.succeeded",
          resourceType: "deployment",
          resourceId: "dep_foundation_20260312_1",
          summary: "Deployment finished healthy.",
          detail: "The control-plane rollout completed and passed health checks.",
          severity: "info",
          metadata: {
            serviceName: "control-plane",
            actorLabel: "docker-ssh-worker"
          },
          createdAt: minutesBefore(1.5)
        },
        {
          id: 5003,
          kind: "execution.job.created",
          resourceType: "deployment",
          resourceId: "dep_foundation_20260311_1",
          summary: "Prepared retryable worker job.",
          detail: "The failed release candidate was handed off to the docker-ssh queue.",
          severity: "info",
          metadata: {
            serviceName: "control-plane",
            actorLabel: "control-plane"
          },
          createdAt: minutesBefore(70)
        },
        {
          id: 5004,
          kind: "deployment.failed",
          resourceType: "deployment",
          resourceId: "dep_foundation_20260311_1",
          summary: "Deployment failed readiness checks.",
          detail: "The new container restarted twice and did not become healthy.",
          severity: "error",
          metadata: {
            serviceName: "control-plane",
            actorLabel: "docker-ssh-worker"
          },
          createdAt: minutesBefore(66)
        }
      ])
      .onConflictDoNothing();

    await tx
      .insert(approvalRequests)
      .values({
        id: "approval_restore_prod_guard",
        actionType: "backup-restore",
        targetResource: "backup-run/brun_foundation_volume_success",
        reason: "Need operator confirmation before replaying a production volume snapshot.",
        status: "pending",
        requestedByUserId: "user_planner_agent",
        requestedByEmail: "planner-agent@daoflow.local",
        requestedByRole: "agent",
        resolvedByUserId: null,
        resolvedByEmail: null,
        inputSummary: {
          riskLevel: "critical",
          resourceLabel: "postgres-volume@production-us-west",
          commandSummary:
            "Restore s3://daoflow-backups/prod/postgres-volume-2026-03-11.tar.zst to foundation-vps-1:/var/lib/postgresql/data.",
          recommendedChecks: [
            "Confirm the target volume is isolated from live writes before replaying snapshot data.",
            "Verify the latest successful backup artifact still matches the registered volume mount path."
          ],
          requestedAt: minutesBefore(55).toISOString(),
          expiresAt: hoursAfter(7).toISOString(),
          targetType: "volume",
          serviceName: "postgres-volume",
          environmentName: "production-us-west"
        },
        createdAt: minutesBefore(55),
        resolvedAt: null
      })
      .onConflictDoNothing();
  });

  console.log("Seeded DaoFlow foundation control-plane data.");
}

if (import.meta.main) {
  seedControlPlaneData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
