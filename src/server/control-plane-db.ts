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
  `);

  for (const migration of [
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
  actorLabel: string
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
  actorLabel: string
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
  actorLabel: string,
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

export function triggerBackupRun(policyId: string, requestedBy: string) {
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
