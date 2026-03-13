/**
 * Standalone Drizzle migration runner for DaoFlow.
 *
 * Enables pgvector extension and runs Drizzle migrations.
 * Usage: bun packages/server/src/db/migration.ts
 *
 * Based on the sk-179 migration pattern.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  console.log("Starting database migration... DATABASE_URL [:15]", connectionString.slice(0, 15));

  const pool = new Pool({ connectionString });

  try {
    // Enable pgvector extension
    console.log("Enabling pgvector extension...");
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("pgvector extension ready ✓");

    // Run Drizzle migrations
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Drizzle migrations completed ✓");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

void main();
