import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  getApiTokenScopeLanes,
  getEffectiveTokenCapabilities,
  normalizeApiTokenScopes,
  roleCapabilities,
  type ApiTokenScope,
  type ApiTokenScopeLane,
  type AppRole
} from "../shared/authz";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type DeploymentStatus = "healthy" | "failed" | "running" | "queued";
export type DeploymentSourceType = "compose" | "dockerfile" | "image";
export type DeploymentStepStatus = "pending" | "completed" | "failed" | "running";
export type PrincipalKind = "human" | "service-account" | "agent";
export type ApiTokenStatus = "active" | "paused" | "expired";
export type ExecutionJobStatus = "pending" | "dispatched" | "completed" | "failed";
export type DeploymentEventLevel = "info" | "warning" | "error";
export type BackupTargetType = "volume" | "database";
export type BackupRunStatus = "queued" | "running" | "succeeded" | "failed";
export type AuditActorType = "human" | "system";
export type AuditResourceType = "deployment" | "execution-job" | "backup-run" | "backup-policy";
export type DeploymentLogStream = "stdout" | "stderr";
export type DeploymentEventKind =
  | "deployment.queued"
  | "execution.job.created"
  | "execution.job.dispatched"
  | "execution.job.completed"
  | "execution.job.failed"
  | "step.pending"
  | "step.running"
  | "step.completed"
  | "step.failed"
  | "deployment.succeeded"
  | "deployment.failed";

export interface DeploymentStepRecord {
  id: string;
  deploymentId: string;
  position: number;
  label: string;
  status: DeploymentStepStatus;
  detail: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface DeploymentRecord {
  id: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  sourceType: DeploymentSourceType;
  status: DeploymentStatus;
  targetServerName: string;
  targetServerHost: string;
  commitSha: string;
  imageTag: string;
  requestedByUserId: string;
  requestedByEmail: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
  steps: DeploymentStepRecord[];
}

export interface CreateDeploymentRecordInput {
  projectName: string;
  environmentName: string;
  serviceName: string;
  sourceType: DeploymentSourceType;
  targetServerId: string;
  commitSha: string;
  imageTag: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
  steps: readonly {
    label: string;
    detail: string;
  }[];
}

export interface ExecutionJobRecord {
  id: string;
  deploymentId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetServerName: string;
  targetServerHost: string;
  status: ExecutionJobStatus;
  queueName: string;
  workerHint: string;
  attemptCount: number;
  createdAt: string;
  availableAt: string;
}

export interface ExecutionQueueSnapshot {
  summary: {
    totalJobs: number;
    pendingJobs: number;
    dispatchedJobs: number;
    completedJobs: number;
    failedJobs: number;
  };
  jobs: ExecutionJobRecord[];
}

export interface OperationsTimelineEvent {
  id: string;
  deploymentId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  kind: DeploymentEventKind;
  level: DeploymentEventLevel;
  summary: string;
  detail: string;
  actorType: "human" | "system";
  actorLabel: string;
  createdAt: string;
}

export interface DeploymentInsightEvidence {
  kind: "step" | "event";
  id: string;
  title: string;
  detail: string;
}

export interface DeploymentInsightRecord {
  deploymentId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  status: DeploymentStatus;
  summary: string;
  suspectedRootCause: string;
  safeActions: string[];
  evidence: DeploymentInsightEvidence[];
  healthyBaseline:
    | {
        deploymentId: string;
        commitSha: string;
        imageTag: string;
        finishedAt: string | null;
      }
    | null;
}

export interface AuditEntryRecord {
  id: string;
  actorType: AuditActorType;
  actorId: string | null;
  actorLabel: string;
  actorRole: AppRole | null;
  action: string;
  resourceType: AuditResourceType;
  resourceId: string;
  resourceLabel: string;
  detail: string;
  createdAt: string;
}

export interface AuditTrailSnapshot {
  summary: {
    totalEntries: number;
    deploymentActions: number;
    executionActions: number;
    backupActions: number;
    humanEntries: number;
  };
  entries: AuditEntryRecord[];
}

export interface DeploymentLogLineRecord {
  id: string;
  deploymentId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  stream: DeploymentLogStream;
  lineNumber: number;
  message: string;
  createdAt: string;
}

export interface DeploymentLogSnapshot {
  summary: {
    totalLines: number;
    stderrLines: number;
    deploymentCount: number;
  };
  lines: DeploymentLogLineRecord[];
}

export interface ExecutionJobMutationResult {
  status: "ok" | "not-found" | "invalid-state";
  currentStatus?: ExecutionJobStatus;
  job?: ExecutionJobRecord;
}

export interface BackupPolicyRecord {
  id: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetType: BackupTargetType;
  storageProvider: string;
  scheduleLabel: string;
  retentionCount: number;
  nextRunAt: string;
  lastRunAt: string | null;
}

export interface BackupRunRecord {
  id: string;
  policyId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetType: BackupTargetType;
  status: BackupRunStatus;
  triggerKind: "scheduled" | "manual";
  requestedBy: string;
  artifactPath: string | null;
  bytesWritten: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface BackupOverview {
  summary: {
    totalPolicies: number;
    queuedRuns: number;
    runningRuns: number;
    succeededRuns: number;
    failedRuns: number;
  };
  policies: BackupPolicyRecord[];
  runs: BackupRunRecord[];
}

export interface ServerInventoryRecord {
  id: string;
  name: string;
  host: string;
  kind: string;
  region: string;
  sshPort: number;
  engineVersion: string;
  status: "healthy" | "degraded" | "offline";
  lastHeartbeatAt: string | null;
  environmentCount: number;
}

export interface ProjectInventoryRecord {
  id: string;
  name: string;
  repositoryUrl: string;
  defaultBranch: string;
  serviceCount: number;
  environmentCount: number;
  latestDeploymentStatus: DeploymentStatus;
}

export interface EnvironmentInventoryRecord {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  targetServerName: string;
  networkName: string;
  composeFilePath: string;
  serviceCount: number;
  status: DeploymentStatus;
}

export interface InfrastructureInventory {
  summary: {
    totalServers: number;
    totalProjects: number;
    totalEnvironments: number;
    healthyServers: number;
  };
  servers: ServerInventoryRecord[];
  projects: ProjectInventoryRecord[];
  environments: EnvironmentInventoryRecord[];
}

export interface ApiTokenRecord {
  id: string;
  principalId: string;
  principalName: string;
  principalKind: PrincipalKind;
  principalRole: AppRole;
  label: string;
  tokenPrefix: string;
  status: ApiTokenStatus;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  scopes: ApiTokenScope[];
  lanes: ApiTokenScopeLane[];
  effectiveCapabilities: string[];
  withheldCapabilities: string[];
  isReadOnly: boolean;
}

export interface ApiTokenInventory {
  summary: {
    totalTokens: number;
    agentTokens: number;
    readOnlyTokens: number;
    planningTokens: number;
    commandTokens: number;
    inactiveTokens: number;
  };
  tokens: ApiTokenRecord[];
}

interface SeedExecutionJob {
  id: string;
  deploymentId: string;
  targetServerId: string;
  status: ExecutionJobStatus;
  queueName: string;
  workerHint: string;
  attemptCount: number;
  createdAt: string;
  availableAt: string;
}

interface SeedDeploymentEvent {
  id: string;
  deploymentId: string;
  kind: DeploymentEventKind;
  level: DeploymentEventLevel;
  summary: string;
  detail: string;
  actorType: "human" | "system";
  actorLabel: string;
  createdAt: string;
}

interface SeedBackupPolicy {
  id: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetType: BackupTargetType;
  storageProvider: string;
  scheduleLabel: string;
  retentionCount: number;
  nextRunAt: string;
  lastRunAt: string | null;
}

interface SeedBackupRun {
  id: string;
  policyId: string;
  status: BackupRunStatus;
  triggerKind: "scheduled" | "manual";
  requestedBy: string;
  artifactPath: string | null;
  bytesWritten: number | null;
  startedAt: string;
  finishedAt: string | null;
}

interface SeedAuditEntry {
  id: string;
  actorType: AuditActorType;
  actorId: string | null;
  actorLabel: string;
  actorRole: AppRole | null;
  action: string;
  resourceType: AuditResourceType;
  resourceId: string;
  resourceLabel: string;
  detail: string;
  createdAt: string;
}

interface SeedDeploymentLogLine {
  id: string;
  deploymentId: string;
  stream: DeploymentLogStream;
  lineNumber: number;
  message: string;
  createdAt: string;
}

interface SeedProject {
  id: string;
  name: string;
  repositoryUrl: string;
  defaultBranch: string;
  serviceCount: number;
}

interface SeedEnvironment {
  id: string;
  projectId: string;
  name: string;
  targetServerId: string;
  networkName: string;
  composeFilePath: string;
  serviceCount: number;
  status: DeploymentStatus;
}

function resolveControlPlaneDatabasePath() {
  if (process.env.CONTROL_PLANE_DB_PATH) {
    return process.env.CONTROL_PLANE_DB_PATH;
  }

  if (process.env.NODE_ENV === "test") {
    return ":memory:";
  }

  return path.resolve(process.cwd(), "data", "control-plane.sqlite");
}

function createControlPlaneDatabase() {
  const databasePath = resolveControlPlaneDatabasePath();

  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  return new DatabaseSync(databasePath);
}

const controlPlaneDb = createControlPlaneDatabase();

function seedControlPlaneData() {
  const now = new Date("2026-03-12T08:00:00.000Z");
  const serverId = "srv_foundation_1";
  const deploymentId = "dep_foundation_20260312_1";
  const previousDeploymentId = "dep_foundation_20260311_1";
  const seedProjects = [
    {
      id: "proj_daoflow_control_plane",
      name: "DaoFlow",
      repositoryUrl: "https://github.com/daoflow/daoflow",
      defaultBranch: "main",
      serviceCount: 3
    },
    {
      id: "proj_agent_bridge",
      name: "Agent Bridge",
      repositoryUrl: "https://github.com/daoflow/agent-bridge",
      defaultBranch: "main",
      serviceCount: 2
    }
  ] as const satisfies readonly SeedProject[];
  const seedEnvironments = [
    {
      id: "env_daoflow_production",
      projectId: "proj_daoflow_control_plane",
      name: "production-us-west",
      targetServerId: serverId,
      networkName: "daoflow-prod",
      composeFilePath: "/srv/daoflow/production/compose.yaml",
      serviceCount: 3,
      status: "healthy"
    },
    {
      id: "env_daoflow_staging",
      projectId: "proj_daoflow_control_plane",
      name: "staging",
      targetServerId: serverId,
      networkName: "daoflow-staging",
      composeFilePath: "/srv/daoflow/staging/compose.yaml",
      serviceCount: 2,
      status: "queued"
    },
    {
      id: "env_agent_bridge_lab",
      projectId: "proj_agent_bridge",
      name: "lab",
      targetServerId: serverId,
      networkName: "agent-bridge-lab",
      composeFilePath: "/srv/agent-bridge/lab/compose.yaml",
      serviceCount: 2,
      status: "failed"
    }
  ] as const satisfies readonly SeedEnvironment[];
  const seedBackupPolicies = [
    {
      id: "bpol_foundation_volume_daily",
      projectName: "DaoFlow",
      environmentName: "production-us-west",
      serviceName: "postgres-volume",
      targetType: "volume",
      storageProvider: "s3-compatible",
      scheduleLabel: "Daily at 02:00 UTC",
      retentionCount: 14,
      nextRunAt: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString(),
      lastRunAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: "bpol_foundation_db_hourly",
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "control-plane-db",
      targetType: "database",
      storageProvider: "s3-compatible",
      scheduleLabel: "Hourly",
      retentionCount: 48,
      nextRunAt: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
      lastRunAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    }
  ] as const satisfies readonly SeedBackupPolicy[];
  const seedBackupRuns = [
    {
      id: "brun_foundation_volume_success",
      policyId: "bpol_foundation_volume_daily",
      status: "succeeded",
      triggerKind: "scheduled",
      requestedBy: "scheduler",
      artifactPath: "s3://daoflow-backups/prod/postgres-volume-2026-03-11.tar.zst",
      bytesWritten: 73400320,
      startedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString()
    },
    {
      id: "brun_foundation_db_failed",
      policyId: "bpol_foundation_db_hourly",
      status: "failed",
      triggerKind: "scheduled",
      requestedBy: "scheduler",
      artifactPath: null,
      bytesWritten: null,
      startedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(now.getTime() - 53 * 60 * 1000).toISOString()
    }
  ] as const satisfies readonly SeedBackupRun[];
  const seedExecutionJobs = [
    {
      id: "job_foundation_20260312_1",
      deploymentId,
      targetServerId: serverId,
      status: "completed",
      queueName: "docker-ssh",
      workerHint: "ssh://foundation-vps-1/docker-engine",
      attemptCount: 1,
      createdAt: new Date(now.getTime() - 7 * 60 * 1000).toISOString(),
      availableAt: new Date(now.getTime() - 7 * 60 * 1000).toISOString()
    },
    {
      id: "job_foundation_20260311_1",
      deploymentId: previousDeploymentId,
      targetServerId: serverId,
      status: "failed",
      queueName: "docker-ssh",
      workerHint: "ssh://foundation-vps-1/docker-engine",
      attemptCount: 1,
      createdAt: new Date(now.getTime() - 70 * 60 * 1000).toISOString(),
      availableAt: new Date(now.getTime() - 70 * 60 * 1000).toISOString()
    }
  ] as const satisfies readonly SeedExecutionJob[];
  const seedAuditEntries = [
    {
      id: "audit_foundation_deployment_create",
      actorType: "human",
      actorId: "user_foundation_owner",
      actorLabel: "owner@daoflow.local",
      actorRole: "owner",
      action: "deployment.create",
      resourceType: "deployment",
      resourceId: deploymentId,
      resourceLabel: "control-plane@production-us-west",
      detail: "Queued the seeded control-plane rollout for production-us-west.",
      createdAt: new Date(now.getTime() - 7 * 60 * 1000).toISOString()
    },
    {
      id: "audit_foundation_execution_complete",
      actorType: "human",
      actorId: "user_foundation_owner",
      actorLabel: "owner@daoflow.local",
      actorRole: "owner",
      action: "execution.complete",
      resourceType: "execution-job",
      resourceId: "job_foundation_20260312_1",
      resourceLabel: "control-plane@production-us-west",
      detail: "Marked the seeded production rollout healthy after worker completion.",
      createdAt: new Date(now.getTime() - 90 * 1000).toISOString()
    },
    {
      id: "audit_foundation_backup_schedule",
      actorType: "system",
      actorId: null,
      actorLabel: "scheduler",
      actorRole: null,
      action: "backup.schedule",
      resourceType: "backup-run",
      resourceId: "brun_foundation_volume_success",
      resourceLabel: "postgres-volume@production-us-west",
      detail: "Recorded the scheduled volume backup snapshot for the production database volume.",
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString()
    }
  ] as const satisfies readonly SeedAuditEntry[];
  const seedDeploymentLogLines = [
    {
      id: "log_foundation_healthy_1",
      deploymentId,
      stream: "stdout",
      lineNumber: 1,
      message: "Resolved compose overlays for production-us-west.",
      createdAt: new Date(now.getTime() - 6 * 60 * 1000).toISOString()
    },
    {
      id: "log_foundation_healthy_2",
      deploymentId,
      stream: "stdout",
      lineNumber: 2,
      message: "Pulled ghcr.io/daoflow/control-plane:0.1.0 from registry cache.",
      createdAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    },
    {
      id: "log_foundation_healthy_3",
      deploymentId,
      stream: "stdout",
      lineNumber: 3,
      message: "Health probe stayed green for 90 seconds.",
      createdAt: new Date(now.getTime() - 90 * 1000).toISOString()
    },
    {
      id: "log_foundation_failed_1",
      deploymentId: previousDeploymentId,
      stream: "stdout",
      lineNumber: 1,
      message: "Pulled ghcr.io/daoflow/control-plane:0.1.0-rc1.",
      createdAt: new Date(now.getTime() - 69 * 60 * 1000).toISOString()
    },
    {
      id: "log_foundation_failed_2",
      deploymentId: previousDeploymentId,
      stream: "stderr",
      lineNumber: 2,
      message: "Container exited with code 1 during readiness probe.",
      createdAt: new Date(now.getTime() - 67 * 60 * 1000).toISOString()
    },
    {
      id: "log_foundation_failed_3",
      deploymentId: previousDeploymentId,
      stream: "stderr",
      lineNumber: 3,
      message: "Readiness endpoint /healthz returned 503 for 2 consecutive checks.",
      createdAt: new Date(now.getTime() - 66 * 60 * 1000).toISOString()
    }
  ] as const satisfies readonly SeedDeploymentLogLine[];
  const seedEvents = [
    {
      id: "evt_foundation_queued",
      deploymentId,
      kind: "execution.job.created",
      level: "info",
      summary: "Prepared SSH-backed execution handoff.",
      detail: "The deployment was packaged for the docker-ssh worker queue.",
      actorType: "system",
      actorLabel: "control-plane",
      createdAt: new Date(now.getTime() - 7 * 60 * 1000).toISOString()
    },
    {
      id: "evt_foundation_succeeded",
      deploymentId,
      kind: "deployment.succeeded",
      level: "info",
      summary: "Deployment finished healthy.",
      detail: "The control-plane rollout completed and passed health checks.",
      actorType: "system",
      actorLabel: "docker-ssh-worker",
      createdAt: new Date(now.getTime() - 90 * 1000).toISOString()
    },
    {
      id: "evt_foundation_previous_job",
      deploymentId: previousDeploymentId,
      kind: "execution.job.created",
      level: "info",
      summary: "Prepared retryable worker job.",
      detail: "The failed release candidate was handed off to the docker-ssh queue.",
      actorType: "system",
      actorLabel: "control-plane",
      createdAt: new Date(now.getTime() - 70 * 60 * 1000).toISOString()
    },
    {
      id: "evt_foundation_previous_failed",
      deploymentId: previousDeploymentId,
      kind: "deployment.failed",
      level: "error",
      summary: "Deployment failed readiness checks.",
      detail: "The new container restarted twice and did not become healthy.",
      actorType: "system",
      actorLabel: "docker-ssh-worker",
      createdAt: new Date(now.getTime() - 66 * 60 * 1000).toISOString()
    }
  ] as const satisfies readonly SeedDeploymentEvent[];
  const apiTokens = [
    {
      id: "token_observer_readonly",
      principalId: "principal_observer_agent_1",
      label: "readonly-observer",
      tokenPrefix: "df_read_4f39",
      status: "active",
      createdAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: null,
      lastUsedAt: new Date(now.getTime() - 6 * 60 * 1000).toISOString(),
      scopes: ["read.projects", "read.deployments", "read.logs"]
    },
    {
      id: "token_planner_agent",
      principalId: "principal_planner_agent_1",
      label: "planner-agent",
      tokenPrefix: "df_plan_7ab2",
      status: "active",
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000).toISOString(),
      lastUsedAt: new Date(now.getTime() - 75 * 60 * 1000).toISOString(),
      scopes: ["read.projects", "read.deployments", "read.logs", "agents.plan"]
    },
    {
      id: "token_release_service",
      principalId: "principal_release_service_1",
      label: "release-service",
      tokenPrefix: "df_cmd_2cd8",
      status: "paused",
      createdAt: new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: null,
      lastUsedAt: new Date(now.getTime() - 19 * 60 * 60 * 1000).toISOString(),
      scopes: [
        "read.projects",
        "read.deployments",
        "read.logs",
        "agents.plan",
        "deploy.execute"
      ]
    }
  ] as const satisfies readonly {
    id: string;
    principalId: string;
    label: string;
    tokenPrefix: string;
    status: ApiTokenStatus;
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
    scopes: readonly ApiTokenScope[];
  }[];
  const steps = [
    {
      id: "step_clone",
      deploymentId,
      position: 1,
      label: "Resolve compose spec",
      status: "completed",
      detail: "Rendered compose overlays for production-us-west.",
      startedAt: new Date(now.getTime() - 6 * 60 * 1000).toISOString(),
      finishedAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    },
    {
      id: "step_pull",
      deploymentId,
      position: 2,
      label: "Pull image",
      status: "completed",
      detail: "Pulled ghcr.io/daoflow/control-plane:0.1.0.",
      startedAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      finishedAt: new Date(now.getTime() - 3 * 60 * 1000).toISOString()
    },
    {
      id: "step_health",
      deploymentId,
      position: 3,
      label: "Health check",
      status: "completed",
      detail: "HTTP health probe stayed healthy for 90 seconds.",
      startedAt: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
      finishedAt: new Date(now.getTime() - 90 * 1000).toISOString()
    }
  ] as const;

  controlPlaneDb.exec(`
    INSERT OR IGNORE INTO principals (id, name, kind, role, created_at)
    VALUES
      ('principal_owner_1', 'DaoFlow Owner', 'human', 'owner', '${new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000).toISOString()}'),
      ('principal_release_service_1', 'Release Service', 'service-account', 'operator', '${new Date(now.getTime() - 18 * 24 * 60 * 60 * 1000).toISOString()}'),
      ('principal_observer_agent_1', 'Incident Observer', 'agent', 'agent', '${new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()}'),
      ('principal_planner_agent_1', 'Planner Agent', 'agent', 'agent', '${new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()}');

    INSERT OR IGNORE INTO servers (id, name, host, kind, created_at)
    VALUES ('${serverId}', 'foundation-vps-1', '10.0.0.14', 'docker-engine', '${now.toISOString()}');

    UPDATE servers
    SET
      region = 'us-west-2',
      ssh_port = 22,
      engine_version = 'Docker Engine 28.0',
      status = 'healthy',
      last_heartbeat_at = '${new Date(now.getTime() - 45 * 1000).toISOString()}'
    WHERE id = '${serverId}';

    INSERT OR IGNORE INTO deployments (
      id,
      project_name,
      environment_name,
      service_name,
      source_type,
      status,
      target_server_id,
      commit_sha,
      image_tag,
      requested_by_user_id,
      requested_by_email,
      created_at,
      started_at,
      finished_at
    )
    VALUES
      (
        '${deploymentId}',
        'DaoFlow',
        'production-us-west',
        'control-plane',
        'compose',
        'healthy',
        '${serverId}',
        '03e40ca',
        'ghcr.io/daoflow/control-plane:0.1.0',
        'user_foundation_owner',
        'owner@daoflow.local',
        '${new Date(now.getTime() - 7 * 60 * 1000).toISOString()}',
        '${new Date(now.getTime() - 6 * 60 * 1000).toISOString()}',
        '${new Date(now.getTime() - 90 * 1000).toISOString()}'
      ),
      (
        '${previousDeploymentId}',
        'DaoFlow',
        'production-us-west',
        'control-plane',
        'compose',
        'failed',
        '${serverId}',
        'ca6e8b0',
        'ghcr.io/daoflow/control-plane:0.1.0-rc1',
        'user_foundation_owner',
        'owner@daoflow.local',
        '${new Date(now.getTime() - 70 * 60 * 1000).toISOString()}',
        '${new Date(now.getTime() - 69 * 60 * 1000).toISOString()}',
        '${new Date(now.getTime() - 66 * 60 * 1000).toISOString()}'
      );
  `);

  const insertApiToken = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO api_tokens (
      id,
      principal_id,
      label,
      token_prefix,
      status,
      created_at,
      expires_at,
      last_used_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertApiTokenScope = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO api_token_scopes (
      token_id,
      scope
    )
    VALUES (?, ?)
  `);

  for (const token of apiTokens) {
    insertApiToken.run(
      token.id,
      token.principalId,
      token.label,
      token.tokenPrefix,
      token.status,
      token.createdAt,
      token.expiresAt,
      token.lastUsedAt
    );

    for (const scope of token.scopes) {
      insertApiTokenScope.run(token.id, scope);
    }
  }

  const insertStep = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO deployment_steps (
      id,
      deployment_id,
      position,
      label,
      status,
      detail,
      started_at,
      finished_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertExecutionJob = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO execution_jobs (
      id,
      deployment_id,
      target_server_id,
      status,
      queue_name,
      worker_hint,
      attempt_count,
      created_at,
      available_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO deployment_events (
      id,
      deployment_id,
      kind,
      level,
      summary,
      detail,
      actor_type,
      actor_label,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBackupPolicy = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO backup_policies (
      id,
      project_name,
      environment_name,
      service_name,
      target_type,
      storage_provider,
      schedule_label,
      retention_count,
      next_run_at,
      last_run_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBackupRun = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO backup_runs (
      id,
      policy_id,
      status,
      trigger_kind,
      requested_by,
      artifact_path,
      bytes_written,
      started_at,
      finished_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEnvironment = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO environments (
      id,
      project_id,
      name,
      target_server_id,
      network_name,
      compose_file_path,
      service_count,
      status,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAuditEntry = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO audit_entries (
      id,
      actor_type,
      actor_id,
      actor_label,
      actor_role,
      action,
      resource_type,
      resource_id,
      resource_label,
      detail,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDeploymentLogLine = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO deployment_log_lines (
      id,
      deployment_id,
      stream,
      line_number,
      message,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertProject = controlPlaneDb.prepare(`
    INSERT OR IGNORE INTO projects (
      id,
      name,
      repository_url,
      default_branch,
      service_count,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const [index, project] of seedProjects.entries()) {
    insertProject.run(
      project.id,
      project.name,
      project.repositoryUrl,
      project.defaultBranch,
      project.serviceCount,
      new Date(now.getTime() - (40 - index * 16) * 24 * 60 * 60 * 1000).toISOString()
    );
  }

  for (const step of steps) {
    insertStep.run(
      step.id,
      step.deploymentId,
      step.position,
      step.label,
      step.status,
      step.detail,
      step.startedAt,
      step.finishedAt
    );
  }

  insertStep.run(
    "step_previous_pull",
    previousDeploymentId,
    1,
    "Pull image",
    "completed",
    "Pulled release candidate image.",
    new Date(now.getTime() - 69 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 68 * 60 * 1000).toISOString()
  );
  insertStep.run(
    "step_previous_health",
    previousDeploymentId,
    2,
    "Health check",
    "failed",
    "New container restarted twice and failed readiness checks.",
    new Date(now.getTime() - 68 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 66 * 60 * 1000).toISOString()
  );

  for (const job of seedExecutionJobs) {
    insertExecutionJob.run(
      job.id,
      job.deploymentId,
      job.targetServerId,
      job.status,
      job.queueName,
      job.workerHint,
      job.attemptCount,
      job.createdAt,
      job.availableAt
    );
  }

  for (const event of seedEvents) {
    insertEvent.run(
      event.id,
      event.deploymentId,
      event.kind,
      event.level,
      event.summary,
      event.detail,
      event.actorType,
      event.actorLabel,
      event.createdAt
    );
  }

  for (const entry of seedAuditEntries) {
    insertAuditEntry.run(
      entry.id,
      entry.actorType,
      entry.actorId,
      entry.actorLabel,
      entry.actorRole,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.resourceLabel,
      entry.detail,
      entry.createdAt
    );
  }

  for (const line of seedDeploymentLogLines) {
    insertDeploymentLogLine.run(
      line.id,
      line.deploymentId,
      line.stream,
      line.lineNumber,
      line.message,
      line.createdAt
    );
  }

  for (const environment of seedEnvironments) {
    insertEnvironment.run(
      environment.id,
      environment.projectId,
      environment.name,
      environment.targetServerId,
      environment.networkName,
      environment.composeFilePath,
      environment.serviceCount,
      environment.status,
      now.toISOString()
    );
  }

  for (const policy of seedBackupPolicies) {
    insertBackupPolicy.run(
      policy.id,
      policy.projectName,
      policy.environmentName,
      policy.serviceName,
      policy.targetType,
      policy.storageProvider,
      policy.scheduleLabel,
      policy.retentionCount,
      policy.nextRunAt,
      policy.lastRunAt
    );
  }

  for (const run of seedBackupRuns) {
    insertBackupRun.run(
      run.id,
      run.policyId,
      run.status,
      run.triggerKind,
      run.requestedBy,
      run.artifactPath,
      run.bytesWritten,
      run.startedAt,
      run.finishedAt
    );
  }
}

const controlPlaneReady = Promise.resolve().then(() => {
  controlPlaneDb.exec(`
    CREATE TABLE IF NOT EXISTS principals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS api_token_scopes (
      token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      PRIMARY KEY (token_id, scope)
    );

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      kind TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT 'unknown',
      ssh_port INTEGER NOT NULL DEFAULT 22,
      engine_version TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'healthy',
      last_heartbeat_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repository_url TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      service_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_server_id TEXT NOT NULL REFERENCES servers(id),
      network_name TEXT NOT NULL,
      compose_file_path TEXT NOT NULL,
      service_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      environment_name TEXT NOT NULL,
      service_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL,
      target_server_id TEXT NOT NULL REFERENCES servers(id),
      commit_sha TEXT NOT NULL,
      image_tag TEXT NOT NULL,
      requested_by_user_id TEXT NOT NULL DEFAULT 'system',
      requested_by_email TEXT NOT NULL DEFAULT 'system@daoflow.local',
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS deployment_steps (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS execution_jobs (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      target_server_id TEXT NOT NULL REFERENCES servers(id),
      status TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      worker_hint TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      available_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployment_events (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      level TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_label TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_policies (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      environment_name TEXT NOT NULL,
      service_name TEXT NOT NULL,
      target_type TEXT NOT NULL,
      storage_provider TEXT NOT NULL,
      schedule_label TEXT NOT NULL,
      retention_count INTEGER NOT NULL,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT
    );

    CREATE TABLE IF NOT EXISTS backup_runs (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES backup_policies(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      artifact_path TEXT,
      bytes_written INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_entries (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      actor_label TEXT NOT NULL,
      actor_role TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_label TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployment_log_lines (
      id TEXT PRIMARY KEY,
      deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      stream TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_execution_jobs_deployment_id
      ON execution_jobs (deployment_id);
    CREATE INDEX IF NOT EXISTS idx_execution_jobs_status_created_at
      ON execution_jobs (status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_execution_jobs_target_server_id
      ON execution_jobs (target_server_id);
    CREATE INDEX IF NOT EXISTS idx_deployment_events_created_at
      ON deployment_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deployment_events_deployment_created_at
      ON deployment_events (deployment_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_backup_runs_policy_started_at
      ON backup_runs (policy_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_backup_runs_status_started_at
      ON backup_runs (status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entries_created_at
      ON audit_entries (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entries_action_created_at
      ON audit_entries (action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deployment_log_lines_created_at
      ON deployment_log_lines (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deployment_log_lines_deployment_line_number
      ON deployment_log_lines (deployment_id, line_number ASC);
    CREATE INDEX IF NOT EXISTS idx_environments_project_id
      ON environments (project_id);
    CREATE INDEX IF NOT EXISTS idx_environments_target_server_id
      ON environments (target_server_id);
  `);

  for (const migration of [
    "ALTER TABLE servers ADD COLUMN region TEXT NOT NULL DEFAULT 'unknown'",
    "ALTER TABLE servers ADD COLUMN ssh_port INTEGER NOT NULL DEFAULT 22",
    "ALTER TABLE servers ADD COLUMN engine_version TEXT NOT NULL DEFAULT 'unknown'",
    "ALTER TABLE servers ADD COLUMN status TEXT NOT NULL DEFAULT 'healthy'",
    "ALTER TABLE servers ADD COLUMN last_heartbeat_at TEXT",
    "ALTER TABLE deployments ADD COLUMN requested_by_user_id TEXT NOT NULL DEFAULT 'system'",
    "ALTER TABLE deployments ADD COLUMN requested_by_email TEXT NOT NULL DEFAULT 'system@daoflow.local'"
  ]) {
    try {
      controlPlaneDb.exec(migration);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }

  seedControlPlaneData();
});

export async function ensureControlPlaneReady() {
  await controlPlaneReady;
}

interface DeploymentRow {
  id: string;
  project_name: string;
  environment_name: string;
  service_name: string;
  source_type: DeploymentSourceType;
  status: DeploymentStatus;
  target_server_name: string;
  target_server_host: string;
  commit_sha: string;
  image_tag: string;
  requested_by_user_id: string;
  requested_by_email: string;
  created_at: string;
  started_at: string;
  finished_at: string | null;
}

interface DeploymentStepRow {
  id: string;
  deployment_id: string;
  position: number;
  label: string;
  status: DeploymentStepStatus;
  detail: string;
  started_at: string;
  finished_at: string | null;
}

interface ApiTokenRow {
  id: string;
  principal_id: string;
  principal_name: string;
  principal_kind: PrincipalKind;
  principal_role: AppRole;
  label: string;
  token_prefix: string;
  status: ApiTokenStatus;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

interface ApiTokenScopeRow {
  token_id: string;
  scope: string;
}

interface ExecutionJobRow {
  id: string;
  deployment_id: string;
  project_name: string;
  environment_name: string;
  service_name: string;
  target_server_name: string;
  target_server_host: string;
  status: ExecutionJobStatus;
  queue_name: string;
  worker_hint: string;
  attempt_count: number;
  created_at: string;
  available_at: string;
}

interface DeploymentEventRow {
  id: string;
  deployment_id: string;
  project_name: string;
  environment_name: string;
  service_name: string;
  kind: DeploymentEventKind;
  level: DeploymentEventLevel;
  summary: string;
  detail: string;
  actor_type: "human" | "system";
  actor_label: string;
  created_at: string;
}

interface DeploymentStepStateRow {
  id: string;
  position: number;
  label: string;
  detail: string;
  status: DeploymentStepStatus;
  started_at: string;
  finished_at: string | null;
}

interface BackupPolicyRow {
  id: string;
  project_name: string;
  environment_name: string;
  service_name: string;
  target_type: BackupTargetType;
  storage_provider: string;
  schedule_label: string;
  retention_count: number;
  next_run_at: string;
  last_run_at: string | null;
}

interface BackupRunRow {
  id: string;
  policy_id: string;
  project_name: string;
  environment_name: string;
  service_name: string;
  target_type: BackupTargetType;
  status: BackupRunStatus;
  trigger_kind: "scheduled" | "manual";
  requested_by: string;
  artifact_path: string | null;
  bytes_written: number | null;
  started_at: string;
  finished_at: string | null;
}

interface AuditEntryRow {
  id: string;
  actor_type: AuditActorType;
  actor_id: string | null;
  actor_label: string;
  actor_role: AppRole | null;
  action: string;
  resource_type: AuditResourceType;
  resource_id: string;
  resource_label: string;
  detail: string;
  created_at: string;
}

interface DeploymentLogLineRow {
  id: string;
  deployment_id: string;
  project_name: string;
  environment_name: string;
  service_name: string;
  stream: DeploymentLogStream;
  line_number: number;
  message: string;
  created_at: string;
}

interface ServerInventoryRow {
  id: string;
  name: string;
  host: string;
  kind: string;
  region: string;
  ssh_port: number;
  engine_version: string;
  status: "healthy" | "degraded" | "offline";
  last_heartbeat_at: string | null;
  environment_count: number;
}

interface ProjectInventoryRow {
  id: string;
  name: string;
  repository_url: string;
  default_branch: string;
  service_count: number;
  environment_count: number;
  latest_deployment_status: DeploymentStatus | null;
}

interface EnvironmentInventoryRow {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  target_server_name: string;
  network_name: string;
  compose_file_path: string;
  service_count: number;
  status: DeploymentStatus;
}

function getDeploymentRows(options?: { status?: DeploymentStatus; limit?: number }) {
  const status = options?.status;
  const limit = options?.limit ?? 50;
  const deploymentQuery = status
    ? controlPlaneDb.prepare(`
        SELECT
          deployments.id,
          deployments.project_name,
          deployments.environment_name,
          deployments.service_name,
          deployments.source_type,
          deployments.status,
          deployments.commit_sha,
          deployments.image_tag,
          deployments.requested_by_user_id,
          deployments.requested_by_email,
          deployments.created_at,
          deployments.started_at,
          deployments.finished_at,
          servers.name AS target_server_name,
          servers.host AS target_server_host
        FROM deployments
        INNER JOIN servers ON servers.id = deployments.target_server_id
        WHERE deployments.status = ?
        ORDER BY deployments.started_at DESC
        LIMIT ?
      `)
    : controlPlaneDb.prepare(`
        SELECT
          deployments.id,
          deployments.project_name,
          deployments.environment_name,
          deployments.service_name,
          deployments.source_type,
          deployments.status,
          deployments.commit_sha,
          deployments.image_tag,
          deployments.requested_by_user_id,
          deployments.requested_by_email,
          deployments.created_at,
          deployments.started_at,
          deployments.finished_at,
          servers.name AS target_server_name,
          servers.host AS target_server_host
        FROM deployments
        INNER JOIN servers ON servers.id = deployments.target_server_id
        ORDER BY deployments.started_at DESC
        LIMIT ?
      `);

  return (status
    ? deploymentQuery.all(status, limit)
    : deploymentQuery.all(limit)) as unknown as DeploymentRow[];
}

function listStepsForDeployments(deploymentIds: readonly string[]) {
  const stepsByDeploymentId = new Map<string, DeploymentStepRecord[]>();

  if (deploymentIds.length === 0) {
    return stepsByDeploymentId;
  }

  const placeholders = deploymentIds.map(() => "?").join(", ");
  const stepRows = controlPlaneDb.prepare(`
    SELECT
      id,
      deployment_id,
      position,
      label,
      status,
      detail,
      started_at,
      finished_at
    FROM deployment_steps
    WHERE deployment_id IN (${placeholders})
    ORDER BY deployment_id ASC, position ASC
  `).all(...deploymentIds) as unknown as DeploymentStepRow[];

  for (const step of stepRows) {
    const currentSteps = stepsByDeploymentId.get(step.deployment_id) ?? [];
    currentSteps.push({
      id: step.id,
      deploymentId: step.deployment_id,
      position: step.position,
      label: step.label,
      status: step.status,
      detail: step.detail,
      startedAt: step.started_at,
      finishedAt: step.finished_at
    });
    stepsByDeploymentId.set(step.deployment_id, currentSteps);
  }

  return stepsByDeploymentId;
}

function mapDeploymentRows(rows: readonly DeploymentRow[]) {
  const stepsByDeploymentId = listStepsForDeployments(rows.map((row) => row.id));

  return rows.map((row) => ({
    id: row.id,
    projectName: row.project_name,
    environmentName: row.environment_name,
    serviceName: row.service_name,
    sourceType: row.source_type,
    status: row.status,
    targetServerName: row.target_server_name,
    targetServerHost: row.target_server_host,
    commitSha: row.commit_sha,
    imageTag: row.image_tag,
    requestedByUserId: row.requested_by_user_id,
    requestedByEmail: row.requested_by_email,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    steps: stepsByDeploymentId.get(row.id) ?? []
  }));
}

export function listDeploymentRecords(status?: DeploymentStatus, limit = 50): DeploymentRecord[] {
  return mapDeploymentRows(getDeploymentRows({ status, limit }));
}

export function getDeploymentRecord(deploymentId: string) {
  const deploymentRow = controlPlaneDb.prepare(`
    SELECT
      deployments.id,
      deployments.project_name,
      deployments.environment_name,
      deployments.service_name,
      deployments.source_type,
      deployments.status,
      deployments.commit_sha,
      deployments.image_tag,
      deployments.requested_by_user_id,
      deployments.requested_by_email,
      deployments.created_at,
      deployments.started_at,
      deployments.finished_at,
      servers.name AS target_server_name,
      servers.host AS target_server_host
    FROM deployments
    INNER JOIN servers ON servers.id = deployments.target_server_id
    WHERE deployments.id = ?
    LIMIT 1
  `).get(deploymentId) as DeploymentRow | undefined;

  if (!deploymentRow) {
    return null;
  }

  return mapDeploymentRows([deploymentRow])[0] ?? null;
}

function sanitizeDeploymentSegment(value: string) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return sanitized.length > 0 ? sanitized : "service";
}

function getServerSummary(serverId: string) {
  return controlPlaneDb.prepare(`
    SELECT
      id,
      name,
      host
    FROM servers
    WHERE id = ?
    LIMIT 1
  `).get(serverId) as
    | {
        id: string;
        name: string;
        host: string;
      }
    | undefined;
}

export function createDeploymentRecord(input: CreateDeploymentRecordInput) {
  const server = getServerSummary(input.targetServerId);

  if (!server) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const deploymentId = `dep_${sanitizeDeploymentSegment(input.serviceName)}_${randomUUID().slice(0, 8)}`;
  const insertDeployment = controlPlaneDb.prepare(`
    INSERT INTO deployments (
      id,
      project_name,
      environment_name,
      service_name,
      source_type,
      status,
      target_server_id,
      commit_sha,
      image_tag,
      requested_by_user_id,
      requested_by_email,
      created_at,
      started_at,
      finished_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStep = controlPlaneDb.prepare(`
    INSERT INTO deployment_steps (
      id,
      deployment_id,
      position,
      label,
      status,
      detail,
      started_at,
      finished_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertExecutionJob = controlPlaneDb.prepare(`
    INSERT INTO execution_jobs (
      id,
      deployment_id,
      target_server_id,
      status,
      queue_name,
      worker_hint,
      attempt_count,
      created_at,
      available_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = controlPlaneDb.prepare(`
    INSERT INTO deployment_events (
      id,
      deployment_id,
      kind,
      level,
      summary,
      detail,
      actor_type,
      actor_label,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const jobId = `job_${randomUUID().slice(0, 8)}`;
  const queueName = "docker-ssh";
  const workerHint = `ssh://${server.name}/docker-engine`;

  controlPlaneDb.exec("BEGIN");

  try {
    insertDeployment.run(
      deploymentId,
      input.projectName,
      input.environmentName,
      input.serviceName,
      input.sourceType,
      "queued",
      input.targetServerId,
      input.commitSha,
      input.imageTag,
      input.requestedByUserId,
      input.requestedByEmail,
      createdAt,
      createdAt,
      null
    );

    input.steps.forEach((step, index) => {
      insertStep.run(
        `step_${randomUUID()}`,
        deploymentId,
        index + 1,
        step.label,
        "pending",
        step.detail,
        createdAt,
        null
      );

      insertEvent.run(
        `evt_${randomUUID().slice(0, 8)}`,
        deploymentId,
        "step.pending",
        "info",
        `Step ${index + 1} is pending execution.`,
        step.detail,
        "system",
        "control-plane",
        createdAt
      );
    });

    insertExecutionJob.run(
      jobId,
      deploymentId,
      input.targetServerId,
      "pending",
      queueName,
      workerHint,
      0,
      createdAt,
      createdAt
    );

    insertEvent.run(
      `evt_${randomUUID().slice(0, 8)}`,
      deploymentId,
      "deployment.queued",
      "info",
      "Deployment record queued for execution.",
      `Queued ${input.serviceName} for ${input.environmentName}.`,
      "human",
      input.requestedByEmail,
      createdAt
    );
    insertEvent.run(
      `evt_${randomUUID().slice(0, 8)}`,
      deploymentId,
      "execution.job.created",
      "info",
      "Worker handoff is ready.",
      `Prepared a ${queueName} job for ${server.name}.`,
      "system",
      "control-plane",
      createdAt
    );
    appendAuditEntry({
      actorType: "human",
      actorId: input.requestedByUserId,
      actorLabel: input.requestedByEmail,
      actorRole: input.requestedByRole,
      action: "deployment.create",
      resourceType: "deployment",
      resourceId: deploymentId,
      resourceLabel: `${input.serviceName}@${input.environmentName}`,
      detail: `Queued a ${input.sourceType} deployment on ${server.name}.`,
      createdAt
    });
    appendDeploymentLogLine(
      deploymentId,
      "stdout",
      `Control plane queued ${input.serviceName} for ${input.environmentName} on ${server.name}.`,
      createdAt
    );

    controlPlaneDb.exec("COMMIT");
  } catch (error) {
    controlPlaneDb.exec("ROLLBACK");
    throw error;
  }

  return getDeploymentRecord(deploymentId);
}

function getExecutionJobRows(options?: {
  status?: ExecutionJobStatus;
  limit?: number;
}) {
  const status = options?.status;
  const limit = options?.limit ?? 20;
  const query = status
    ? controlPlaneDb.prepare(`
        SELECT
          execution_jobs.id,
          execution_jobs.deployment_id,
          execution_jobs.status,
          execution_jobs.queue_name,
          execution_jobs.worker_hint,
          execution_jobs.attempt_count,
          execution_jobs.created_at,
          execution_jobs.available_at,
          deployments.project_name,
          deployments.environment_name,
          deployments.service_name,
          servers.name AS target_server_name,
          servers.host AS target_server_host
        FROM execution_jobs
        INNER JOIN deployments ON deployments.id = execution_jobs.deployment_id
        INNER JOIN servers ON servers.id = execution_jobs.target_server_id
        WHERE execution_jobs.status = ?
        ORDER BY execution_jobs.created_at DESC
        LIMIT ?
      `)
    : controlPlaneDb.prepare(`
        SELECT
          execution_jobs.id,
          execution_jobs.deployment_id,
          execution_jobs.status,
          execution_jobs.queue_name,
          execution_jobs.worker_hint,
          execution_jobs.attempt_count,
          execution_jobs.created_at,
          execution_jobs.available_at,
          deployments.project_name,
          deployments.environment_name,
          deployments.service_name,
          servers.name AS target_server_name,
          servers.host AS target_server_host
        FROM execution_jobs
        INNER JOIN deployments ON deployments.id = execution_jobs.deployment_id
        INNER JOIN servers ON servers.id = execution_jobs.target_server_id
        ORDER BY execution_jobs.created_at DESC
        LIMIT ?
      `);

  return (status ? query.all(status, limit) : query.all(limit)) as unknown as ExecutionJobRow[];
}

function getExecutionJobSummary(status?: ExecutionJobStatus) {
  const query = status
    ? controlPlaneDb.prepare(`
        SELECT
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_jobs,
          SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) AS dispatched_jobs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_jobs,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs
        FROM execution_jobs
        WHERE status = ?
      `)
    : controlPlaneDb.prepare(`
        SELECT
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_jobs,
          SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) AS dispatched_jobs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_jobs,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs
        FROM execution_jobs
      `);

  return (status ? query.get(status) : query.get()) as
    | {
        total_jobs?: number;
        pending_jobs?: number;
        dispatched_jobs?: number;
        completed_jobs?: number;
        failed_jobs?: number;
      }
    | undefined;
}

function getExecutionJobRow(jobId: string) {
  return controlPlaneDb.prepare(`
    SELECT
      execution_jobs.id,
      execution_jobs.deployment_id,
      execution_jobs.status,
      execution_jobs.queue_name,
      execution_jobs.worker_hint,
      execution_jobs.attempt_count,
      execution_jobs.created_at,
      execution_jobs.available_at,
      deployments.project_name,
      deployments.environment_name,
      deployments.service_name,
      servers.name AS target_server_name,
      servers.host AS target_server_host
    FROM execution_jobs
    INNER JOIN deployments ON deployments.id = execution_jobs.deployment_id
    INNER JOIN servers ON servers.id = execution_jobs.target_server_id
    WHERE execution_jobs.id = ?
    LIMIT 1
  `).get(jobId) as ExecutionJobRow | undefined;
}

function mapExecutionJobRow(row: ExecutionJobRow): ExecutionJobRecord {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectName: row.project_name,
    environmentName: row.environment_name,
    serviceName: row.service_name,
    targetServerName: row.target_server_name,
    targetServerHost: row.target_server_host,
    status: row.status,
    queueName: row.queue_name,
    workerHint: row.worker_hint,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    availableAt: row.available_at
  };
}

function getStepStateRows(deploymentId: string) {
  return controlPlaneDb.prepare(`
    SELECT
      id,
      position,
      label,
      detail,
      status,
      started_at,
      finished_at
    FROM deployment_steps
    WHERE deployment_id = ?
    ORDER BY position ASC
  `).all(deploymentId) as unknown as DeploymentStepStateRow[];
}

function appendDeploymentEvent(
  deploymentId: string,
  kind: DeploymentEventKind,
  level: DeploymentEventLevel,
  summary: string,
  detail: string,
  actorType: "human" | "system",
  actorLabel: string,
  createdAt: string
) {
  controlPlaneDb.prepare(`
    INSERT INTO deployment_events (
      id,
      deployment_id,
      kind,
      level,
      summary,
      detail,
      actor_type,
      actor_label,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `evt_${randomUUID().slice(0, 8)}`,
    deploymentId,
    kind,
    level,
    summary,
    detail,
    actorType,
    actorLabel,
    createdAt
  );
}

function appendAuditEntry(entry: Omit<AuditEntryRecord, "id">) {
  controlPlaneDb.prepare(`
    INSERT INTO audit_entries (
      id,
      actor_type,
      actor_id,
      actor_label,
      actor_role,
      action,
      resource_type,
      resource_id,
      resource_label,
      detail,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `audit_${randomUUID()}`,
    entry.actorType,
    entry.actorId,
    entry.actorLabel,
    entry.actorRole,
    entry.action,
    entry.resourceType,
    entry.resourceId,
    entry.resourceLabel,
    entry.detail,
    entry.createdAt
  );
}

function getNextDeploymentLogLineNumber(deploymentId: string) {
  const row = controlPlaneDb.prepare(`
    SELECT MAX(line_number) AS max_line_number
    FROM deployment_log_lines
    WHERE deployment_id = ?
  `).get(deploymentId) as { max_line_number?: number | null } | undefined;

  return (row?.max_line_number ?? 0) + 1;
}

function appendDeploymentLogLine(
  deploymentId: string,
  stream: DeploymentLogStream,
  message: string,
  createdAt: string
) {
  controlPlaneDb.prepare(`
    INSERT INTO deployment_log_lines (
      id,
      deployment_id,
      stream,
      line_number,
      message,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    `log_${randomUUID()}`,
    deploymentId,
    stream,
    getNextDeploymentLogLineNumber(deploymentId),
    message,
    createdAt
  );
}

export function listExecutionQueue(status?: ExecutionJobStatus, limit = 20): ExecutionQueueSnapshot {
  const jobs = getExecutionJobRows({ status, limit }).map((row) => mapExecutionJobRow(row));
  const summary = getExecutionJobSummary(status);

  return {
    summary: {
      totalJobs: summary?.total_jobs ?? 0,
      pendingJobs: summary?.pending_jobs ?? 0,
      dispatchedJobs: summary?.dispatched_jobs ?? 0,
      completedJobs: summary?.completed_jobs ?? 0,
      failedJobs: summary?.failed_jobs ?? 0
    },
    jobs
  };
}

export function dispatchExecutionJob(
  jobId: string,
  actorId: string,
  actorLabel: string,
  actorRole: AppRole
): ExecutionJobMutationResult {
  const jobRow = getExecutionJobRow(jobId);

  if (!jobRow) {
    return { status: "not-found" };
  }

  if (jobRow.status !== "pending") {
    return {
      status: "invalid-state",
      currentStatus: jobRow.status
    };
  }

  const now = new Date().toISOString();
  const stepRows = getStepStateRows(jobRow.deployment_id);
  const nextStep = stepRows.find((step) => step.status === "pending");

  controlPlaneDb.exec("BEGIN");

  try {
    controlPlaneDb.prepare(`
      UPDATE execution_jobs
      SET
        status = 'dispatched',
        attempt_count = attempt_count + 1,
        available_at = ?
      WHERE id = ?
    `).run(now, jobId);

    controlPlaneDb.prepare(`
      UPDATE deployments
      SET
        status = 'running',
        started_at = ?
      WHERE id = ?
    `).run(now, jobRow.deployment_id);

    if (nextStep) {
      controlPlaneDb.prepare(`
        UPDATE deployment_steps
        SET
          status = 'running',
          started_at = ?
        WHERE id = ?
      `).run(now, nextStep.id);

      appendDeploymentEvent(
        jobRow.deployment_id,
        "step.running",
        "info",
        `${nextStep.label} is now running.`,
        nextStep.detail,
        "system",
        "docker-ssh-worker",
        now
      );
    }

    appendDeploymentEvent(
      jobRow.deployment_id,
      "execution.job.dispatched",
      "info",
      "Worker claimed the queued job.",
      `Execution started for ${jobRow.service_name} on ${jobRow.target_server_name}.`,
      "human",
      actorLabel,
      now
    );
    appendAuditEntry({
      actorType: "human",
      actorId,
      actorLabel,
      actorRole,
      action: "execution.dispatch",
      resourceType: "execution-job",
      resourceId: jobId,
      resourceLabel: `${jobRow.service_name}@${jobRow.environment_name}`,
      detail: `Dispatched the ${jobRow.queue_name} worker handoff to ${jobRow.target_server_name}.`,
      createdAt: now
    });
    appendDeploymentLogLine(
      jobRow.deployment_id,
      "stdout",
      `Worker claimed the queued job on ${jobRow.target_server_name}.`,
      now
    );

    controlPlaneDb.exec("COMMIT");
  } catch (error) {
    controlPlaneDb.exec("ROLLBACK");
    throw error;
  }

  const updatedJobRow = getExecutionJobRow(jobId);

  return updatedJobRow
    ? {
        status: "ok",
        job: mapExecutionJobRow(updatedJobRow)
      }
    : { status: "not-found" };
}

export function completeExecutionJob(
  jobId: string,
  actorId: string,
  actorLabel: string,
  actorRole: AppRole
): ExecutionJobMutationResult {
  const jobRow = getExecutionJobRow(jobId);

  if (!jobRow) {
    return { status: "not-found" };
  }

  if (jobRow.status !== "dispatched") {
    return {
      status: "invalid-state",
      currentStatus: jobRow.status
    };
  }

  const now = new Date().toISOString();
  const stepRows = getStepStateRows(jobRow.deployment_id);

  controlPlaneDb.exec("BEGIN");

  try {
    controlPlaneDb.prepare(`
      UPDATE execution_jobs
      SET status = 'completed'
      WHERE id = ?
    `).run(jobId);

    controlPlaneDb.prepare(`
      UPDATE deployments
      SET
        status = 'healthy',
        finished_at = ?
      WHERE id = ?
    `).run(now, jobRow.deployment_id);

    for (const step of stepRows.filter((row) => row.status !== "completed")) {
      controlPlaneDb.prepare(`
        UPDATE deployment_steps
        SET
          status = 'completed',
          finished_at = ?
        WHERE id = ?
      `).run(now, step.id);

      appendDeploymentEvent(
        jobRow.deployment_id,
        "step.completed",
        "info",
        `${step.label} completed.`,
        step.detail,
        "system",
        "docker-ssh-worker",
        now
      );
    }

    appendDeploymentEvent(
      jobRow.deployment_id,
      "execution.job.completed",
      "info",
      "Worker completed the execution job.",
      `The execution worker reported success for ${jobRow.service_name}.`,
      "human",
      actorLabel,
      now
    );
    appendDeploymentEvent(
      jobRow.deployment_id,
      "deployment.succeeded",
      "info",
      "Deployment reached a healthy state.",
      `${jobRow.service_name} finished successfully in ${jobRow.environment_name}.`,
      "system",
      "docker-ssh-worker",
      now
    );
    appendAuditEntry({
      actorType: "human",
      actorId,
      actorLabel,
      actorRole,
      action: "execution.complete",
      resourceType: "execution-job",
      resourceId: jobId,
      resourceLabel: `${jobRow.service_name}@${jobRow.environment_name}`,
      detail: `Marked the rollout healthy after worker success on ${jobRow.target_server_name}.`,
      createdAt: now
    });
    appendDeploymentLogLine(
      jobRow.deployment_id,
      "stdout",
      `${jobRow.service_name} reported healthy on ${jobRow.target_server_name}.`,
      now
    );

    controlPlaneDb.exec("COMMIT");
  } catch (error) {
    controlPlaneDb.exec("ROLLBACK");
    throw error;
  }

  const updatedJobRow = getExecutionJobRow(jobId);

  return updatedJobRow
    ? {
        status: "ok",
        job: mapExecutionJobRow(updatedJobRow)
      }
    : { status: "not-found" };
}

export function failExecutionJob(
  jobId: string,
  actorId: string,
  actorLabel: string,
  actorRole: AppRole,
  reason?: string
): ExecutionJobMutationResult {
  const jobRow = getExecutionJobRow(jobId);

  if (!jobRow) {
    return { status: "not-found" };
  }

  if (jobRow.status !== "dispatched") {
    return {
      status: "invalid-state",
      currentStatus: jobRow.status
    };
  }

  const now = new Date().toISOString();
  const stepRows = getStepStateRows(jobRow.deployment_id);
  const failedStep =
    stepRows.find((step) => step.status === "running") ??
    stepRows.find((step) => step.status === "pending");

  controlPlaneDb.exec("BEGIN");

  try {
    controlPlaneDb.prepare(`
      UPDATE execution_jobs
      SET status = 'failed'
      WHERE id = ?
    `).run(jobId);

    controlPlaneDb.prepare(`
      UPDATE deployments
      SET
        status = 'failed',
        finished_at = ?
      WHERE id = ?
    `).run(now, jobRow.deployment_id);

    if (failedStep) {
      controlPlaneDb.prepare(`
        UPDATE deployment_steps
        SET
          status = 'failed',
          finished_at = ?
        WHERE id = ?
      `).run(now, failedStep.id);

      appendDeploymentEvent(
        jobRow.deployment_id,
        "step.failed",
        "error",
        `${failedStep.label} failed.`,
        reason ?? failedStep.detail,
        "system",
        "docker-ssh-worker",
        now
      );
    }

    appendDeploymentEvent(
      jobRow.deployment_id,
      "execution.job.failed",
      "error",
      "Worker reported a failed execution job.",
      reason ?? `The execution worker failed ${jobRow.service_name}.`,
      "human",
      actorLabel,
      now
    );
    appendDeploymentEvent(
      jobRow.deployment_id,
      "deployment.failed",
      "error",
      "Deployment entered a failed state.",
      reason ?? `${jobRow.service_name} failed during execution.`,
      "system",
      "docker-ssh-worker",
      now
    );
    appendAuditEntry({
      actorType: "human",
      actorId,
      actorLabel,
      actorRole,
      action: "execution.fail",
      resourceType: "execution-job",
      resourceId: jobId,
      resourceLabel: `${jobRow.service_name}@${jobRow.environment_name}`,
      detail: reason ?? `Marked the rollout failed after a worker-side error on ${jobRow.target_server_name}.`,
      createdAt: now
    });
    appendDeploymentLogLine(
      jobRow.deployment_id,
      "stderr",
      reason ?? `${jobRow.service_name} failed on ${jobRow.target_server_name}.`,
      now
    );

    controlPlaneDb.exec("COMMIT");
  } catch (error) {
    controlPlaneDb.exec("ROLLBACK");
    throw error;
  }

  const updatedJobRow = getExecutionJobRow(jobId);

  return updatedJobRow
    ? {
        status: "ok",
        job: mapExecutionJobRow(updatedJobRow)
      }
    : { status: "not-found" };
}

export function listOperationsTimeline(deploymentId?: string, limit = 20) {
  const query = deploymentId
    ? controlPlaneDb.prepare(`
        SELECT
          deployment_events.id,
          deployment_events.deployment_id,
          deployment_events.kind,
          deployment_events.level,
          deployment_events.summary,
          deployment_events.detail,
          deployment_events.actor_type,
          deployment_events.actor_label,
          deployment_events.created_at,
          deployments.project_name,
          deployments.environment_name,
          deployments.service_name
        FROM deployment_events
        INNER JOIN deployments ON deployments.id = deployment_events.deployment_id
        WHERE deployment_events.deployment_id = ?
        ORDER BY deployment_events.created_at DESC
        LIMIT ?
      `)
    : controlPlaneDb.prepare(`
        SELECT
          deployment_events.id,
          deployment_events.deployment_id,
          deployment_events.kind,
          deployment_events.level,
          deployment_events.summary,
          deployment_events.detail,
          deployment_events.actor_type,
          deployment_events.actor_label,
          deployment_events.created_at,
          deployments.project_name,
          deployments.environment_name,
          deployments.service_name
        FROM deployment_events
        INNER JOIN deployments ON deployments.id = deployment_events.deployment_id
        ORDER BY deployment_events.created_at DESC
        LIMIT ?
      `);

  const rows = (deploymentId ? query.all(deploymentId, limit) : query.all(limit)) as unknown as DeploymentEventRow[];

  return rows.map((row) => ({
    id: row.id,
    deploymentId: row.deployment_id,
    projectName: row.project_name,
    environmentName: row.environment_name,
    serviceName: row.service_name,
    kind: row.kind,
    level: row.level,
    summary: row.summary,
    detail: row.detail,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    createdAt: row.created_at
  })) satisfies OperationsTimelineEvent[];
}

function getReferenceHealthyDeployment(deployment: DeploymentRecord) {
  const row = controlPlaneDb.prepare(`
    SELECT
      deployments.id,
      deployments.project_name,
      deployments.environment_name,
      deployments.service_name,
      deployments.source_type,
      deployments.status,
      deployments.commit_sha,
      deployments.image_tag,
      deployments.requested_by_user_id,
      deployments.requested_by_email,
      deployments.created_at,
      deployments.started_at,
      deployments.finished_at,
      servers.name AS target_server_name,
      servers.host AS target_server_host
    FROM deployments
    INNER JOIN servers ON servers.id = deployments.target_server_id
    WHERE deployments.project_name = ?
      AND deployments.environment_name = ?
      AND deployments.service_name = ?
      AND deployments.status = 'healthy'
      AND deployments.id != ?
    ORDER BY deployments.created_at DESC
    LIMIT 1
  `).get(
    deployment.projectName,
    deployment.environmentName,
    deployment.serviceName,
    deployment.id
  ) as DeploymentRow | undefined;

  if (!row) {
    return null;
  }

  return mapDeploymentRows([row])[0] ?? null;
}

function buildSafeActions(status: DeploymentStatus, hasHealthyBaseline: boolean) {
  if (status === "failed") {
    return [
      hasHealthyBaseline
        ? "Compare the failed release inputs against the nearest healthy baseline before retrying."
        : "Freeze the current failure inputs before attempting another rollout.",
      "Inspect the cited failing step and event evidence before sending any new command.",
      "Prepare a rollback or redeploy plan, but keep execution gated behind an operator action."
    ];
  }

  if (status === "running") {
    return [
      "Wait for the active step to finish before issuing more changes.",
      "Monitor worker and health-check events instead of retrying preemptively."
    ];
  }

  if (status === "queued") {
    return [
      "Validate the target environment inputs before the worker claims the job.",
      "Confirm the requested commit SHA and image tag match the intended release."
    ];
  }

  return [
    "Use this release as a rollback baseline for the next deployment.",
    "Keep backups and environment metadata current before the next change window."
  ];
}

function buildDeploymentInsight(deployment: DeploymentRecord): DeploymentInsightRecord {
  const timeline = listOperationsTimeline(deployment.id, 12);
  const failedStep = [...deployment.steps].reverse().find((step) => step.status === "failed");
  const runningStep = [...deployment.steps].reverse().find((step) => step.status === "running");
  const pendingStep = deployment.steps.find((step) => step.status === "pending");
  const failedEvent = timeline.find((event) => event.level === "error");
  const latestEvent = timeline[0] ?? null;
  const primaryStep = failedStep ?? runningStep ?? pendingStep ?? deployment.steps.at(-1) ?? null;
  const healthyBaseline = getReferenceHealthyDeployment(deployment);
  const evidence: DeploymentInsightEvidence[] = [];

  if (primaryStep) {
    evidence.push({
      kind: "step",
      id: primaryStep.id,
      title: primaryStep.label,
      detail: primaryStep.detail
    });
  }

  if (failedEvent) {
    evidence.push({
      kind: "event",
      id: failedEvent.id,
      title: failedEvent.summary,
      detail: failedEvent.detail
    });
  } else if (latestEvent) {
    evidence.push({
      kind: "event",
      id: latestEvent.id,
      title: latestEvent.summary,
      detail: latestEvent.detail
    });
  }

  if (deployment.status === "failed") {
    return {
      deploymentId: deployment.id,
      projectName: deployment.projectName,
      environmentName: deployment.environmentName,
      serviceName: deployment.serviceName,
      status: deployment.status,
      summary: primaryStep
        ? `${primaryStep.label} failed and left the deployment unhealthy.`
        : "Deployment failed without a captured step transition.",
      suspectedRootCause: primaryStep?.detail ?? failedEvent?.detail ?? "Execution worker reported failure.",
      safeActions: buildSafeActions(deployment.status, Boolean(healthyBaseline)),
      evidence,
      healthyBaseline: healthyBaseline
        ? {
            deploymentId: healthyBaseline.id,
            commitSha: healthyBaseline.commitSha,
            imageTag: healthyBaseline.imageTag,
            finishedAt: healthyBaseline.finishedAt
          }
        : null
    };
  }

  if (deployment.status === "running") {
    return {
      deploymentId: deployment.id,
      projectName: deployment.projectName,
      environmentName: deployment.environmentName,
      serviceName: deployment.serviceName,
      status: deployment.status,
      summary: primaryStep
        ? `${primaryStep.label} is currently executing.`
        : "Deployment is in progress with no active step recorded.",
      suspectedRootCause:
        primaryStep?.detail ??
        failedEvent?.detail ??
        "Execution has started and is waiting for the next worker update.",
      safeActions: buildSafeActions(deployment.status, Boolean(healthyBaseline)),
      evidence,
      healthyBaseline: healthyBaseline
        ? {
            deploymentId: healthyBaseline.id,
            commitSha: healthyBaseline.commitSha,
            imageTag: healthyBaseline.imageTag,
            finishedAt: healthyBaseline.finishedAt
          }
        : null
    };
  }

  if (deployment.status === "queued") {
    return {
      deploymentId: deployment.id,
      projectName: deployment.projectName,
      environmentName: deployment.environmentName,
      serviceName: deployment.serviceName,
      status: deployment.status,
      summary: "Deployment is queued and waiting for worker dispatch.",
      suspectedRootCause:
        primaryStep?.detail ??
        latestEvent?.detail ??
        "The control plane is waiting for an execution worker to claim the job.",
      safeActions: buildSafeActions(deployment.status, Boolean(healthyBaseline)),
      evidence,
      healthyBaseline: healthyBaseline
        ? {
            deploymentId: healthyBaseline.id,
            commitSha: healthyBaseline.commitSha,
            imageTag: healthyBaseline.imageTag,
            finishedAt: healthyBaseline.finishedAt
          }
        : null
    };
  }

  return {
    deploymentId: deployment.id,
    projectName: deployment.projectName,
    environmentName: deployment.environmentName,
    serviceName: deployment.serviceName,
    status: deployment.status,
    summary: "Deployment is healthy and can serve as a rollback baseline.",
    suspectedRootCause:
      latestEvent?.detail ?? "The most recent worker and step events indicate a healthy rollout.",
    safeActions: buildSafeActions(deployment.status, Boolean(healthyBaseline)),
    evidence,
    healthyBaseline: healthyBaseline
      ? {
          deploymentId: healthyBaseline.id,
          commitSha: healthyBaseline.commitSha,
          imageTag: healthyBaseline.imageTag,
          finishedAt: healthyBaseline.finishedAt
        }
      : null
  };
}

export function listDeploymentInsights(limit = 6) {
  return listDeploymentRecords(undefined, limit).map((deployment) => buildDeploymentInsight(deployment));
}

function getAuditEntryRows(limit = 20) {
  return controlPlaneDb.prepare(`
    SELECT
      id,
      actor_type,
      actor_id,
      actor_label,
      actor_role,
      action,
      resource_type,
      resource_id,
      resource_label,
      detail,
      created_at
    FROM audit_entries
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as unknown as AuditEntryRow[];
}

function getAuditSummary() {
  return controlPlaneDb.prepare(`
    SELECT
      COUNT(*) AS total_entries,
      SUM(CASE WHEN action LIKE 'deployment.%' THEN 1 ELSE 0 END) AS deployment_actions,
      SUM(CASE WHEN action LIKE 'execution.%' THEN 1 ELSE 0 END) AS execution_actions,
      SUM(CASE WHEN action LIKE 'backup.%' THEN 1 ELSE 0 END) AS backup_actions,
      SUM(CASE WHEN actor_type = 'human' THEN 1 ELSE 0 END) AS human_entries
    FROM audit_entries
  `).get() as
    | {
        total_entries?: number;
        deployment_actions?: number;
        execution_actions?: number;
        backup_actions?: number;
        human_entries?: number;
      }
    | undefined;
}

export function listAuditTrail(limit = 20): AuditTrailSnapshot {
  const summary = getAuditSummary();
  const entries = getAuditEntryRows(limit).map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorLabel: row.actor_label,
    actorRole: row.actor_role,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceLabel: row.resource_label,
    detail: row.detail,
    createdAt: row.created_at
  }));

  return {
    summary: {
      totalEntries: summary?.total_entries ?? 0,
      deploymentActions: summary?.deployment_actions ?? 0,
      executionActions: summary?.execution_actions ?? 0,
      backupActions: summary?.backup_actions ?? 0,
      humanEntries: summary?.human_entries ?? 0
    },
    entries
  };
}

function getDeploymentLogLineRows(deploymentId?: string, limit = 20) {
  const query = deploymentId
    ? controlPlaneDb.prepare(`
        SELECT
          deployment_log_lines.id,
          deployment_log_lines.deployment_id,
          deployments.project_name,
          deployments.environment_name,
          deployments.service_name,
          deployment_log_lines.stream,
          deployment_log_lines.line_number,
          deployment_log_lines.message,
          deployment_log_lines.created_at
        FROM deployment_log_lines
        INNER JOIN deployments ON deployments.id = deployment_log_lines.deployment_id
        WHERE deployment_log_lines.deployment_id = ?
        ORDER BY deployment_log_lines.created_at DESC, deployment_log_lines.line_number DESC
        LIMIT ?
      `)
    : controlPlaneDb.prepare(`
        SELECT
          deployment_log_lines.id,
          deployment_log_lines.deployment_id,
          deployments.project_name,
          deployments.environment_name,
          deployments.service_name,
          deployment_log_lines.stream,
          deployment_log_lines.line_number,
          deployment_log_lines.message,
          deployment_log_lines.created_at
        FROM deployment_log_lines
        INNER JOIN deployments ON deployments.id = deployment_log_lines.deployment_id
        ORDER BY deployment_log_lines.created_at DESC, deployment_log_lines.line_number DESC
        LIMIT ?
      `);

  return (deploymentId ? query.all(deploymentId, limit) : query.all(limit)) as unknown as DeploymentLogLineRow[];
}

function getDeploymentLogSummary(deploymentId?: string) {
  const query = deploymentId
    ? controlPlaneDb.prepare(`
        SELECT
          COUNT(*) AS total_lines,
          SUM(CASE WHEN stream = 'stderr' THEN 1 ELSE 0 END) AS stderr_lines,
          COUNT(DISTINCT deployment_id) AS deployment_count
        FROM deployment_log_lines
        WHERE deployment_id = ?
      `)
    : controlPlaneDb.prepare(`
        SELECT
          COUNT(*) AS total_lines,
          SUM(CASE WHEN stream = 'stderr' THEN 1 ELSE 0 END) AS stderr_lines,
          COUNT(DISTINCT deployment_id) AS deployment_count
        FROM deployment_log_lines
      `);

  return (deploymentId ? query.get(deploymentId) : query.get()) as
    | {
        total_lines?: number;
        stderr_lines?: number;
        deployment_count?: number;
      }
    | undefined;
}

export function listDeploymentLogs(deploymentId?: string, limit = 20): DeploymentLogSnapshot {
  const summary = getDeploymentLogSummary(deploymentId);
  const lines = getDeploymentLogLineRows(deploymentId, limit).map((row) => ({
    id: row.id,
    deploymentId: row.deployment_id,
    projectName: row.project_name,
    environmentName: row.environment_name,
    serviceName: row.service_name,
    stream: row.stream,
    lineNumber: row.line_number,
    message: row.message,
    createdAt: row.created_at
  }));

  return {
    summary: {
      totalLines: summary?.total_lines ?? 0,
      stderrLines: summary?.stderr_lines ?? 0,
      deploymentCount: summary?.deployment_count ?? 0
    },
    lines
  };
}

function getBackupPolicyRows() {
  return controlPlaneDb.prepare(`
    SELECT
      id,
      project_name,
      environment_name,
      service_name,
      target_type,
      storage_provider,
      schedule_label,
      retention_count,
      next_run_at,
      last_run_at
    FROM backup_policies
    ORDER BY environment_name ASC, service_name ASC
  `).all() as unknown as BackupPolicyRow[];
}

function getBackupRunRows(limit = 20) {
  return controlPlaneDb.prepare(`
    SELECT
      backup_runs.id,
      backup_runs.policy_id,
      backup_runs.status,
      backup_runs.trigger_kind,
      backup_runs.requested_by,
      backup_runs.artifact_path,
      backup_runs.bytes_written,
      backup_runs.started_at,
      backup_runs.finished_at,
      backup_policies.project_name,
      backup_policies.environment_name,
      backup_policies.service_name,
      backup_policies.target_type
    FROM backup_runs
    INNER JOIN backup_policies ON backup_policies.id = backup_runs.policy_id
    ORDER BY backup_runs.started_at DESC
    LIMIT ?
  `).all(limit) as unknown as BackupRunRow[];
}

function getBackupRunSummary() {
  return controlPlaneDb.prepare(`
    SELECT
      COUNT(*) AS total_runs,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_runs,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_runs,
      SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_runs,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_runs
    FROM backup_runs
  `).get() as
    | {
        total_runs?: number;
        queued_runs?: number;
        running_runs?: number;
        succeeded_runs?: number;
        failed_runs?: number;
      }
    | undefined;
}

export function listBackupOverview(limit = 12): BackupOverview {
  const policies = getBackupPolicyRows().map((row) => ({
    id: row.id,
    projectName: row.project_name,
    environmentName: row.environment_name,
    serviceName: row.service_name,
    targetType: row.target_type,
    storageProvider: row.storage_provider,
    scheduleLabel: row.schedule_label,
    retentionCount: row.retention_count,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at
  }));
  const runs = getBackupRunRows(limit).map((row) => ({
    id: row.id,
    policyId: row.policy_id,
    projectName: row.project_name,
    environmentName: row.environment_name,
    serviceName: row.service_name,
    targetType: row.target_type,
    status: row.status,
    triggerKind: row.trigger_kind,
    requestedBy: row.requested_by,
    artifactPath: row.artifact_path,
    bytesWritten: row.bytes_written,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }));
  const summary = getBackupRunSummary();

  return {
    summary: {
      totalPolicies: policies.length,
      queuedRuns: summary?.queued_runs ?? 0,
      runningRuns: summary?.running_runs ?? 0,
      succeededRuns: summary?.succeeded_runs ?? 0,
      failedRuns: summary?.failed_runs ?? 0
    },
    policies,
    runs
  };
}

export function triggerBackupRun(
  policyId: string,
  requestedByUserId: string,
  requestedBy: string,
  requestedByRole: AppRole
) {
  const policy = controlPlaneDb.prepare(`
    SELECT
      id,
      project_name,
      environment_name,
      service_name,
      target_type,
      storage_provider,
      schedule_label,
      retention_count,
      next_run_at,
      last_run_at
    FROM backup_policies
    WHERE id = ?
    LIMIT 1
  `).get(policyId) as BackupPolicyRow | undefined;

  if (!policy) {
    return null;
  }

  const runId = `brun_${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();

  controlPlaneDb.exec("BEGIN");

  try {
    controlPlaneDb.prepare(`
      INSERT INTO backup_runs (
        id,
        policy_id,
        status,
        trigger_kind,
        requested_by,
        artifact_path,
        bytes_written,
        started_at,
        finished_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      policyId,
      "queued",
      "manual",
      requestedBy,
      null,
      null,
      startedAt,
      null
    );

    appendAuditEntry({
      actorType: "human",
      actorId: requestedByUserId,
      actorLabel: requestedBy,
      actorRole: requestedByRole,
      action: "backup.trigger",
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: `${policy.service_name}@${policy.environment_name}`,
      detail: `Queued a manual ${policy.target_type} backup for ${policy.service_name}.`,
      createdAt: startedAt
    });

    controlPlaneDb.exec("COMMIT");
  } catch (error) {
    controlPlaneDb.exec("ROLLBACK");
    throw error;
  }

  const run = controlPlaneDb.prepare(`
    SELECT
      backup_runs.id,
      backup_runs.policy_id,
      backup_runs.status,
      backup_runs.trigger_kind,
      backup_runs.requested_by,
      backup_runs.artifact_path,
      backup_runs.bytes_written,
      backup_runs.started_at,
      backup_runs.finished_at,
      backup_policies.project_name,
      backup_policies.environment_name,
      backup_policies.service_name,
      backup_policies.target_type
    FROM backup_runs
    INNER JOIN backup_policies ON backup_policies.id = backup_runs.policy_id
    WHERE backup_runs.id = ?
    LIMIT 1
  `).get(runId) as BackupRunRow | undefined;

  if (!run) {
    return null;
  }

  return {
    id: run.id,
    policyId: run.policy_id,
    projectName: run.project_name,
    environmentName: run.environment_name,
    serviceName: run.service_name,
    targetType: run.target_type,
    status: run.status,
    triggerKind: run.trigger_kind,
    requestedBy: run.requested_by,
    artifactPath: run.artifact_path,
    bytesWritten: run.bytes_written,
    startedAt: run.started_at,
    finishedAt: run.finished_at
  } satisfies BackupRunRecord;
}

export function listInfrastructureInventory(): InfrastructureInventory {
  const servers = controlPlaneDb.prepare(`
    SELECT
      servers.id,
      servers.name,
      servers.host,
      servers.kind,
      servers.region,
      servers.ssh_port,
      servers.engine_version,
      servers.status,
      servers.last_heartbeat_at,
      COUNT(environments.id) AS environment_count
    FROM servers
    LEFT JOIN environments ON environments.target_server_id = servers.id
    GROUP BY
      servers.id,
      servers.name,
      servers.host,
      servers.kind,
      servers.region,
      servers.ssh_port,
      servers.engine_version,
      servers.status,
      servers.last_heartbeat_at
    ORDER BY servers.name ASC
  `).all() as unknown as ServerInventoryRow[];
  const projects = controlPlaneDb.prepare(`
    SELECT
      projects.id,
      projects.name,
      projects.repository_url,
      projects.default_branch,
      projects.service_count,
      COUNT(environments.id) AS environment_count,
      (
        SELECT deployments.status
        FROM deployments
        WHERE deployments.project_name = projects.name
        ORDER BY deployments.created_at DESC
        LIMIT 1
      ) AS latest_deployment_status
    FROM projects
    LEFT JOIN environments ON environments.project_id = projects.id
    GROUP BY
      projects.id,
      projects.name,
      projects.repository_url,
      projects.default_branch,
      projects.service_count
    ORDER BY projects.name ASC
  `).all() as unknown as ProjectInventoryRow[];
  const environments = controlPlaneDb.prepare(`
    SELECT
      environments.id,
      environments.project_id,
      projects.name AS project_name,
      environments.name,
      servers.name AS target_server_name,
      environments.network_name,
      environments.compose_file_path,
      environments.service_count,
      environments.status
    FROM environments
    INNER JOIN projects ON projects.id = environments.project_id
    INNER JOIN servers ON servers.id = environments.target_server_id
    ORDER BY projects.name ASC, environments.name ASC
  `).all() as unknown as EnvironmentInventoryRow[];

  return {
    summary: {
      totalServers: servers.length,
      totalProjects: projects.length,
      totalEnvironments: environments.length,
      healthyServers: servers.filter((server) => server.status === "healthy").length
    },
    servers: servers.map((row) => ({
      id: row.id,
      name: row.name,
      host: row.host,
      kind: row.kind,
      region: row.region,
      sshPort: row.ssh_port,
      engineVersion: row.engine_version,
      status: row.status,
      lastHeartbeatAt: row.last_heartbeat_at,
      environmentCount: row.environment_count
    })),
    projects: projects.map((row) => ({
      id: row.id,
      name: row.name,
      repositoryUrl: row.repository_url,
      defaultBranch: row.default_branch,
      serviceCount: row.service_count,
      environmentCount: row.environment_count,
      latestDeploymentStatus: row.latest_deployment_status ?? "queued"
    })),
    environments: environments.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      name: row.name,
      targetServerName: row.target_server_name,
      networkName: row.network_name,
      composeFilePath: row.compose_file_path,
      serviceCount: row.service_count,
      status: row.status
    }))
  };
}

function getApiTokenRows() {
  return controlPlaneDb.prepare(`
    SELECT
      api_tokens.id,
      api_tokens.principal_id,
      api_tokens.label,
      api_tokens.token_prefix,
      api_tokens.status,
      api_tokens.created_at,
      api_tokens.expires_at,
      api_tokens.last_used_at,
      principals.name AS principal_name,
      principals.kind AS principal_kind,
      principals.role AS principal_role
    FROM api_tokens
    INNER JOIN principals ON principals.id = api_tokens.principal_id
    ORDER BY api_tokens.created_at DESC, api_tokens.label ASC
  `).all() as unknown as ApiTokenRow[];
}

function listScopesForTokens(tokenIds: readonly string[]) {
  const scopesByTokenId = new Map<string, ApiTokenScope[]>();

  if (tokenIds.length === 0) {
    return scopesByTokenId;
  }

  const placeholders = tokenIds.map(() => "?").join(", ");
  const scopeRows = controlPlaneDb.prepare(`
    SELECT
      token_id,
      scope
    FROM api_token_scopes
    WHERE token_id IN (${placeholders})
    ORDER BY token_id ASC, scope ASC
  `).all(...tokenIds) as unknown as ApiTokenScopeRow[];

  for (const scopeRow of scopeRows) {
    const scopes = scopesByTokenId.get(scopeRow.token_id) ?? [];
    const normalizedScope = normalizeApiTokenScopes([scopeRow.scope])[0];

    if (normalizedScope) {
      scopes.push(normalizedScope);
      scopesByTokenId.set(scopeRow.token_id, scopes);
    }
  }

  return scopesByTokenId;
}

export function listApiTokenInventory(): ApiTokenInventory {
  const rows = getApiTokenRows();
  const scopesByTokenId = listScopesForTokens(rows.map((row) => row.id));
  const tokens = rows.map((row) => {
    const scopes = scopesByTokenId.get(row.id) ?? [];
    const effectiveCapabilities = getEffectiveTokenCapabilities(row.principal_role, scopes);
    const withheldCapabilities = roleCapabilities[row.principal_role].filter(
      (capability) => !effectiveCapabilities.includes(capability)
    );
    const lanes = getApiTokenScopeLanes(scopes);

    return {
      id: row.id,
      principalId: row.principal_id,
      principalName: row.principal_name,
      principalKind: row.principal_kind,
      principalRole: row.principal_role,
      label: row.label,
      tokenPrefix: row.token_prefix,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      scopes,
      lanes,
      effectiveCapabilities,
      withheldCapabilities,
      isReadOnly: lanes.length > 0 && lanes.every((lane) => lane === "read")
    } satisfies ApiTokenRecord;
  });

  return {
    summary: {
      totalTokens: tokens.length,
      agentTokens: tokens.filter((token) => token.principalKind === "agent").length,
      readOnlyTokens: tokens.filter((token) => token.isReadOnly).length,
      planningTokens: tokens.filter((token) => token.lanes.includes("planning")).length,
      commandTokens: tokens.filter((token) => token.lanes.includes("command")).length,
      inactiveTokens: tokens.filter((token) => token.status !== "active").length
    },
    tokens
  };
}
