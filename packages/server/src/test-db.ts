import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pool, reinitializeDatabaseConnection } from "./db/connection";
import {
  ensureControlPlaneReady,
  resetControlPlaneSeedState,
  waitForControlPlaneSeedIdle
} from "./db/services/seed";
import {
  ensureDatabaseExists,
  resetDatabaseSchema,
  truncateDatabaseTables
} from "./db/reset-database";
import { resolveTestDatabaseUrl } from "./db/test-database-url";
import {
  resetInitialOwnerBootstrapState,
  waitForInitialOwnerBootstrapIdle
} from "./bootstrap-initial-owner";
import {
  resetLocalhostServerBootstrapState,
  waitForLocalhostServerBootstrapIdle
} from "./bootstrap-localhost-server";
import { resetAuthState } from "./auth";

const { Client } = pg;
const TEST_DB_PREPARE_LOCK_ID = 8_705_231;
const MIN_EXPECTED_PUBLIC_TABLES = 30;

let prepared = false;
let preparePromise: Promise<string> | null = null;

async function applyMigrations(connectionString: string) {
  const migrationDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../drizzle"
  );
  const migrationFiles = (await readdir(migrationDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  await resetDatabaseSchema(connectionString);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of migrationFiles) {
      const sql = await readFile(path.join(migrationDir, file), "utf8");
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

async function withTestDatabaseLock<T>(
  connectionString: string,
  callback: () => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [TEST_DB_PREPARE_LOCK_ID]);
    return await callback();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [TEST_DB_PREPARE_LOCK_ID]);
    } finally {
      await client.end();
    }
  }
}

async function isTestSchemaReady(connectionString: string): Promise<boolean> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{
      tableCount: number;
      users: string | null;
      teams: string | null;
      projects: string | null;
      environments: string | null;
      services: string | null;
      deployments: string | null;
      serviceVariables: string | null;
      gitProviders: string | null;
      cliAuthRequests: string | null;
    }>(`
      SELECT
        (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS "tableCount",
        to_regclass('public.users') AS "users",
        to_regclass('public.teams') AS "teams",
        to_regclass('public.projects') AS "projects",
        to_regclass('public.environments') AS "environments",
        to_regclass('public.services') AS "services",
        to_regclass('public.deployments') AS "deployments",
        to_regclass('public.service_variables') AS "serviceVariables",
        to_regclass('public.git_providers') AS "gitProviders",
        to_regclass('public.cli_auth_requests') AS "cliAuthRequests"
    `);
    const row = result.rows[0];
    return Boolean(
      row?.tableCount &&
      row.tableCount >= MIN_EXPECTED_PUBLIC_TABLES &&
      row.users &&
      row.teams &&
      row.projects &&
      row.environments &&
      row.services &&
      row.deployments &&
      row.serviceVariables &&
      row.gitProviders &&
      row.cliAuthRequests
    );
  } finally {
    await client.end();
  }
}

async function isControlPlaneSeedReady(connectionString: string): Promise<boolean> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{
      hasUser: boolean;
      hasTeam: boolean;
      hasServer: boolean;
    }>(`
      SELECT
        EXISTS (SELECT 1 FROM public.users WHERE id = 'user_foundation_owner') AS "hasUser",
        EXISTS (SELECT 1 FROM public.teams WHERE id = 'team_foundation') AS "hasTeam",
        EXISTS (SELECT 1 FROM public.servers WHERE id = 'srv_foundation_1') AS "hasServer"
    `);
    const row = result.rows[0];
    return Boolean(row?.hasUser && row.hasTeam && row.hasServer);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "42P01") {
      return false;
    }

    throw error;
  } finally {
    await client.end();
  }
}

async function readPoolSchemaState() {
  const result = await pool.query<{
    databaseName: string;
    tableCount: number;
    users: string | null;
    teams: string | null;
    projects: string | null;
    environments: string | null;
    services: string | null;
    deployments: string | null;
    serviceVariables: string | null;
    gitProviders: string | null;
    cliAuthRequests: string | null;
  }>(`
    SELECT
      current_database() AS "databaseName",
      (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS "tableCount",
      to_regclass('public.users') AS "users",
      to_regclass('public.teams') AS "teams",
      to_regclass('public.projects') AS "projects",
      to_regclass('public.environments') AS "environments",
      to_regclass('public.services') AS "services",
      to_regclass('public.deployments') AS "deployments",
      to_regclass('public.service_variables') AS "serviceVariables",
      to_regclass('public.git_providers') AS "gitProviders",
      to_regclass('public.cli_auth_requests') AS "cliAuthRequests"
  `);

  return result.rows[0];
}

function readDatabaseName(connectionString: string) {
  return new URL(connectionString).pathname.replace(/^\//, "") || "daoflow_test";
}

async function ensurePooledTestSchemaReady(connectionString: string) {
  const expectedDatabaseName = readDatabaseName(connectionString);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const state = await readPoolSchemaState();
      if (
        state?.databaseName === expectedDatabaseName &&
        state.tableCount >= MIN_EXPECTED_PUBLIC_TABLES &&
        state.users &&
        state.teams &&
        state.projects &&
        state.environments &&
        state.services &&
        state.deployments &&
        state.serviceVariables &&
        state.gitProviders &&
        state.cliAuthRequests
      ) {
        return;
      }
    } catch {
      // Force a pool reconnect below and retry once.
    }

    await reinitializeDatabaseConnection({ connectionString, force: true });
  }

  throw new Error(
    `Test database pool is not ready for ${expectedDatabaseName} after schema reset.`
  );
}

export async function ensureTestDatabaseReady() {
  const connectionString = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = connectionString;
  await reinitializeDatabaseConnection({ connectionString });

  if (prepared && (await isTestSchemaReady(connectionString))) {
    return connectionString;
  }

  if (!preparePromise) {
    preparePromise = (async () => {
      await ensureDatabaseExists(connectionString);
      await withTestDatabaseLock(connectionString, async () => {
        if (!(await isTestSchemaReady(connectionString))) {
          await applyMigrations(connectionString);
        }
      });
      await reinitializeDatabaseConnection({ connectionString, force: true });
      await ensurePooledTestSchemaReady(connectionString);
      prepared = true;
      return connectionString;
    })().finally(() => {
      preparePromise = null;
    });
  }

  await preparePromise;

  return connectionString;
}

export async function resetTestDatabase() {
  const connectionString = await ensureTestDatabaseReady();
  await waitForControlPlaneSeedIdle();
  await waitForInitialOwnerBootstrapIdle();
  await waitForLocalhostServerBootstrapIdle();
  resetControlPlaneSeedState();
  resetInitialOwnerBootstrapState();
  resetLocalhostServerBootstrapState();
  resetAuthState();
  await withTestDatabaseLock(connectionString, async () => {
    if (await isTestSchemaReady(connectionString)) {
      await truncateDatabaseTables(connectionString);
      return;
    }

    await applyMigrations(connectionString);
  });
  await reinitializeDatabaseConnection({ connectionString, force: true });
  await ensurePooledTestSchemaReady(connectionString);
}

export async function resetTestDatabaseWithControlPlane() {
  const connectionString = await ensureTestDatabaseReady();

  await resetTestDatabase();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();
    if (await isControlPlaneSeedReady(connectionString)) {
      return;
    }
  }

  throw new Error("Control-plane seed did not become ready after resetting the test database.");
}

export async function resetSeededTestDatabase() {
  await resetTestDatabaseWithControlPlane();
}
