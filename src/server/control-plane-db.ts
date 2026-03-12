import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type DeploymentStatus = "healthy" | "failed" | "running";
export type DeploymentSourceType = "compose" | "dockerfile" | "image";
export type DeploymentStepStatus = "completed" | "failed" | "running";

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
  const deploymentCountRow = controlPlaneDb
    .prepare('SELECT COUNT(*) AS total FROM deployments')
    .get() as { total?: number } | undefined;

  if ((deploymentCountRow?.total ?? 0) > 0) {
    return;
  }

  const now = new Date("2026-03-12T08:00:00.000Z");
  const serverId = "srv_foundation_1";
  const deploymentId = "dep_foundation_20260312_1";
  const previousDeploymentId = "dep_foundation_20260311_1";
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
