/**
 * Standalone Drizzle migration runner for DaoFlow.
 *
 * Enables pgvector extension and runs Drizzle migrations.
 * Usage: bun packages/server/src/db/migration.ts
 *
 * Based on the sk-179 migration pattern.
 */
import pg from "pg";
import { describeMigrationFailure } from "./migration-lineage";
import { runMigrationCoordinator } from "./migration-runner";

const { Pool } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[migrate] DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  console.log("[migrate] Starting database migration.");

  const pool = new Pool({ connectionString });

  try {
    await runMigrationCoordinator({
      migrationsFolder: "./drizzle",
      pool,
      retryFailedMigration: process.env.DAOFLOW_RETRY_FAILED_MIGRATION === "true"
    });
    console.log("[migrate] Database migrations completed ✓");
  } catch (error) {
    console.error("[migrate] Database migration failed:", describeMigrationFailure(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
