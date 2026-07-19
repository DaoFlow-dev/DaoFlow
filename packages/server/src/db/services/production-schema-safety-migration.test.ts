import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../connection";
import { resetTestDatabaseWithControlPlane } from "../../test-db";

async function readProductionSafetyMigrationStatements() {
  const migrationPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../drizzle/0036_production_schema_safety.sql"
  );
  const migrationSql = await readFile(migrationPath, "utf8");

  return migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyProductionSafetyMigration() {
  for (const statement of await readProductionSafetyMigrationStatements()) {
    await pool.query(statement);
  }
}

describe("production schema safety migration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("fills missing webhook recovery schema when pre-release capacity artifacts already exist", async () => {
    await pool.query(
      'ALTER TABLE "deployments" DROP COLUMN IF EXISTS "webhook_delivery_id" CASCADE'
    );
    await pool.query(
      'ALTER TABLE "deployments" DROP COLUMN IF EXISTS "webhook_target_key" CASCADE'
    );
    await pool.query('DROP TABLE IF EXISTS "webhook_delivery_targets" CASCADE');
    await pool.query('DROP TABLE IF EXISTS "webhook_delivery_attempts" CASCADE');
    await pool.query(
      'ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "body_digest" CASCADE'
    );
    await pool.query(
      'ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "current_attempt_id" CASCADE'
    );
    await pool.query(
      'ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "attempt_count" CASCADE'
    );
    await pool.query(
      'ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "last_error_summary" CASCADE'
    );

    await applyProductionSafetyMigration();
    await applyProductionSafetyMigration();

    const schema = await pool.query<{
      attempts: string | null;
      targets: string | null;
      buildLeases: string | null;
      bodyDigest: string | null;
      webhookDeliveryId: string | null;
      approvalTeamNullable: string | null;
    }>(`SELECT
      to_regclass('public.webhook_delivery_attempts') AS "attempts",
      to_regclass('public.webhook_delivery_targets') AS "targets",
      to_regclass('public.deployment_build_leases') AS "buildLeases",
      (SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'webhook_deliveries'
          AND column_name = 'body_digest') AS "bodyDigest",
      (SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'deployments'
          AND column_name = 'webhook_delivery_id') AS "webhookDeliveryId",
      (SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'approval_requests'
          AND column_name = 'team_id') AS "approvalTeamNullable"`);

    expect(schema.rows[0]).toEqual({
      attempts: "webhook_delivery_attempts",
      targets: "webhook_delivery_targets",
      buildLeases: "deployment_build_leases",
      bodyDigest: "body_digest",
      webhookDeliveryId: "webhook_delivery_id",
      approvalTeamNullable: "NO"
    });
  });
});
