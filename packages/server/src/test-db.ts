import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ensureDatabaseExists, resetDatabaseSchema } from "./db/reset-database";

const { Client } = pg;

let prepared = false;

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

export async function ensureTestDatabaseReady() {
  const connectionString = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = connectionString;

  if (prepared) {
    return connectionString;
  }

  await ensureDatabaseExists(connectionString);
  await applyMigrations(connectionString);
  prepared = true;

  return connectionString;
}

export async function resetTestDatabase() {
  const connectionString = await ensureTestDatabaseReady();
  await applyMigrations(connectionString);
}
