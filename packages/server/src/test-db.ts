import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ensureDatabaseExists, resetDatabaseSchema } from "./db/reset-database";
import { resetControlPlaneSeedState } from "./db/services/seed";

const { Client } = pg;
const TEST_DB_PREPARE_LOCK_ID = 8_705_231;

let prepared = false;
let preparePromise: Promise<string> | null = null;

function resolveBaseDatabaseUrl() {
  return process.env.DATABASE_URL ?? "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow";
}

function resolveTestDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const baseUrl = new URL(resolveBaseDatabaseUrl());
  const databaseName = baseUrl.pathname.replace(/^\//, "") || "daoflow";
  if (databaseName.endsWith("_test")) {
    return baseUrl.toString();
  }
  baseUrl.pathname = `/${databaseName}_test`;
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

  return connectionString;
}

export async function resetTestDatabase() {
  const connectionString = await ensureTestDatabaseReady();
  resetControlPlaneSeedState();
  await withTestDatabaseLock(connectionString, async () => {
    await applyMigrations(connectionString);
  });
}
