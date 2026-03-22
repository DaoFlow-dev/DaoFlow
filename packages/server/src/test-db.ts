import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./db/schema";
import { ensureDatabaseExists, resetDatabaseSchema } from "./db/reset-database";
import { seedDeployments } from "./db/services/seed/seed-deployments";
import { seedInfrastructure } from "./db/services/seed/seed-infrastructure";
import { seedObservability } from "./db/services/seed/seed-observability";
import { seedUsers } from "./db/services/seed/seed-users";

const { Client } = pg;
const TEST_DB_PREPARE_LOCK_ID = 8_705_231;

let prepared = false;
let preparePromise: Promise<string> | null = null;
const baseDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow";

function resolveBaseDatabaseUrl() {
  return baseDatabaseUrl;
}

function resolveVitestWorkerSuffix() {
  const workerId = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID;
  if (!workerId) {
    return "";
  }

  return `_w${workerId.replaceAll(/[^a-zA-Z0-9_-]/g, "")}`;
}

function applyDatabaseNameSuffix(databaseName: string, suffix: string) {
  if (!suffix) {
    return databaseName;
  }

  const maxDatabaseNameLength = 63;
  const truncatedBaseName = databaseName.slice(
    0,
    Math.max(1, maxDatabaseNameLength - suffix.length)
  );
  return `${truncatedBaseName}${suffix}`;
}

function resolveTestDatabaseUrl() {
  const baseUrl = new URL(resolveBaseDatabaseUrl());
  const databaseName = baseUrl.pathname.replace(/^\//, "") || "daoflow";
  const workerSuffix = resolveVitestWorkerSuffix();
  const unsuffixedDatabaseName =
    workerSuffix && databaseName.endsWith(workerSuffix)
      ? databaseName.slice(0, -workerSuffix.length)
      : databaseName;
  const testDatabaseName = unsuffixedDatabaseName.endsWith("_test")
    ? unsuffixedDatabaseName
    : `${unsuffixedDatabaseName}_test`;
  baseUrl.pathname = `/${applyDatabaseNameSuffix(testDatabaseName, workerSuffix)}`;
  return baseUrl.toString();
}

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

async function resetRuntimeBootstrapState() {
  const [{ resetInitialOwnerBootstrapState }, { resetControlPlaneSeedState }, { resetAuthState }] =
    await Promise.all([
      import("./bootstrap-initial-owner"),
      import("./db/services/seed"),
      import("./auth")
    ]);

  resetControlPlaneSeedState();
  resetInitialOwnerBootstrapState();
  resetAuthState();
}

async function seedTestControlPlaneData(connectionString: string) {
  const pool = new pg.Pool({ connectionString });

  try {
    const seedDb = drizzle(pool, { schema });
    await seedDb.transaction(async (tx) => {
      await seedUsers(tx);
      await seedInfrastructure(tx);
      await seedDeployments(tx);
      await seedObservability(tx);
    });
  } finally {
    await pool.end();
  }

  const { primeControlPlaneSeedState } = await import("./db/services/seed");
  primeControlPlaneSeedState();
  console.log("Seeded DaoFlow foundation control-plane data.");
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
      users: string | null;
      deployments: string | null;
      cliAuthRequests: string | null;
    }>(`
      SELECT
        to_regclass('public.users') AS "users",
        to_regclass('public.deployments') AS "deployments",
        to_regclass('public.cli_auth_requests') AS "cliAuthRequests"
    `);
    const row = result.rows[0];
    return Boolean(row?.users && row.deployments && row.cliAuthRequests);
  } finally {
    await client.end();
  }
}

export async function ensureTestDatabaseReady() {
  const connectionString = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = connectionString;

  if (prepared) {
    const { getDatabaseConnectionString, reconfigureDatabasePool } =
      await import("./db/connection");
    if (getDatabaseConnectionString() !== connectionString) {
      await reconfigureDatabasePool(connectionString);
    }
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
      prepared = true;
      return connectionString;
    })().finally(() => {
      preparePromise = null;
    });
  }

  await preparePromise;

  const { getDatabaseConnectionString, reconfigureDatabasePool } = await import("./db/connection");
  if (getDatabaseConnectionString() !== connectionString) {
    await reconfigureDatabasePool(connectionString);
  }

  return connectionString;
}

export async function resetTestDatabase() {
  const connectionString = await ensureTestDatabaseReady();
  await resetRuntimeBootstrapState();
  await withTestDatabaseLock(connectionString, async () => {
    await applyMigrations(connectionString);
  });
  const { reconfigureDatabasePool } = await import("./db/connection");
  await reconfigureDatabasePool(connectionString);
  return connectionString;
}

export async function resetSeededTestDatabase() {
  const connectionString = await resetTestDatabase();
  await seedTestControlPlaneData(connectionString);
}
