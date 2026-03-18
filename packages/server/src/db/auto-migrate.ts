/**
 * Auto-migration for production: run Drizzle migrations on server start.
 *
 * This ensures the database schema is always up-to-date when the server
 * boots — critical for fresh installs and upgrades where the Docker
 * image may contain newer migration files than the running database.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./connection";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run pending Drizzle migrations using the shared connection pool.
 *
 * Safe to call on every boot — Drizzle's migrator is idempotent and
 * only applies migrations not yet recorded in the journal table.
 */
export async function runAutoMigrations(): Promise<void> {
  // Resolve the drizzle migrations folder relative to this file.
  // In dev:  packages/server/src/db/ → ../../../../drizzle
  // In prod: packages/server/dist/   → ../../../drizzle  (but we use the build output)
  //
  // The Docker image copies the drizzle folder to /app/drizzle via the build.
  // We try multiple paths to cover both dev and production layouts.
  const candidates = [
    path.resolve(__dirname, "../../../../drizzle"), // dev: src/db/ → repo root
    path.resolve(__dirname, "../../../drizzle"), // prod: dist/ → /app/drizzle
    path.resolve(process.cwd(), "drizzle") // fallback: cwd/drizzle
  ];

  let migrationsFolder: string | null = null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      migrationsFolder = candidate;
      break;
    }
  }

  if (!migrationsFolder) {
    console.warn("[migrate] No drizzle migrations folder found — skipping auto-migration");
    return;
  }

  // Enable pgvector extension before running schema migrations
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  } catch (err) {
    console.warn(
      "[migrate] Could not enable pgvector extension:",
      err instanceof Error ? err.message : String(err)
    );
  }

  await migrate(db, { migrationsFolder });
  console.log("[migrate] Database migrations completed ✓");
}
