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

export type DeploymentStatus = "healthy" | "failed" | "running";
export type DeploymentSourceType = "compose" | "dockerfile" | "image";
export type DeploymentStepStatus = "completed" | "failed" | "running";
export type PrincipalKind = "human" | "service-account" | "agent";
export type ApiTokenStatus = "active" | "paused" | "expired";

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
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
  steps: DeploymentStepRecord[];
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
  `);

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
