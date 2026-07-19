import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../connection";
import { auditEntries, approvalRequests } from "../schema/audit";
import { environments, projects } from "../schema/projects";
import { teams } from "../schema/teams";
import { resetTestDatabaseWithControlPlane } from "../../test-db";

const validApprovalId = "apr_migration_team_valid";
const quarantinedApprovalId = "apr_migration_team_unknown";
const ambiguousApprovalId = "apr_migration_team_ambiguous";
const projectId = "proj_approval_migration";
const environmentId = "env_approval_migration";
const otherTeamId = "team_approval_migration_other";
const otherProjectId = "proj_approval_migration_other";
const otherEnvironmentId = "env_approval_migration_other";
const composeServiceId = "compose_approval_migration";
const ambiguousComposeServiceId = "compose_approval_ambiguous";

async function applyApprovalTeamOwnershipMigrations() {
  const migrationDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../drizzle"
  );
  const migrationSql = await readFile(
    path.join(migrationDirectory, "0036_production_schema_safety.sql"),
    "utf8"
  );
  const startMarker = "-- custom-approval-team-ownership:start";
  const endMarker = "-- custom-approval-team-ownership:end";
  const start = migrationSql.indexOf(startMarker);
  const end = migrationSql.indexOf(endMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const statements = migrationSql
    .slice(start + startMarker.length, end)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
}

describe("approval team ownership migration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("backfills resolvable targets and quarantines ambiguous legacy approvals", async () => {
    await db.insert(projects).values({
      id: projectId,
      name: "Approval migration project",
      teamId: "team_foundation"
    });
    await db.insert(environments).values({
      id: environmentId,
      name: "Approval migration environment",
      slug: "approval-migration",
      projectId,
      config: {
        composeServices: [
          { id: composeServiceId, serviceName: "migration-valid" },
          { id: ambiguousComposeServiceId, serviceName: "migration-ambiguous" }
        ]
      }
    });
    await db.insert(teams).values({
      id: otherTeamId,
      name: "Approval Migration Other Team",
      slug: "approval-migration-other",
      status: "active",
      createdByUserId: "user_foundation_owner",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await db.insert(projects).values({
      id: otherProjectId,
      name: "Approval migration other project",
      teamId: otherTeamId
    });
    await db.insert(environments).values({
      id: otherEnvironmentId,
      name: "Approval migration other environment",
      slug: "approval-migration-other",
      projectId: otherProjectId,
      config: {
        composeServices: [{ id: ambiguousComposeServiceId, serviceName: "migration-ambiguous" }]
      }
    });

    await pool.query('DROP INDEX IF EXISTS "approval_requests_pending_binding_idx"');
    await pool.query('ALTER TABLE "approval_requests" DROP COLUMN "team_id"');
    await pool.query(`CREATE UNIQUE INDEX "approval_requests_pending_binding_idx"
      ON "approval_requests" USING btree ("binding_key")
      WHERE "approval_requests"."binding_key" is not null
        and "approval_requests"."status" = 'pending'`);
    try {
      await pool.query(
        `INSERT INTO approval_requests (id, action_type, target_resource)
         VALUES
           ($1, 'compose-release', $2),
           ($3, 'compose-release', 'compose-service/missing-service'),
           ($4, 'compose-release', $5)`,
        [
          validApprovalId,
          `compose-service/${composeServiceId}`,
          quarantinedApprovalId,
          ambiguousApprovalId,
          `compose-service/${ambiguousComposeServiceId}`
        ]
      );

      await applyApprovalTeamOwnershipMigrations();

      const [valid] = await db
        .select({ teamId: approvalRequests.teamId })
        .from(approvalRequests)
        .where(eq(approvalRequests.id, validApprovalId));
      expect(valid?.teamId).toBe("team_foundation");

      const [quarantined] = await db
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(eq(approvalRequests.id, quarantinedApprovalId));
      expect(quarantined).toBeUndefined();

      const [ambiguous] = await db
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(eq(approvalRequests.id, ambiguousApprovalId));
      expect(ambiguous).toBeUndefined();

      const [evidence] = await db
        .select({ action: auditEntries.action, metadata: auditEntries.metadata })
        .from(auditEntries)
        .where(eq(auditEntries.targetResource, `approval-request/${quarantinedApprovalId}`));
      expect(evidence).toMatchObject({
        action: "approval.quarantine",
        metadata: {
          approvalRequestId: quarantinedApprovalId,
          reason: "unresolved-team-ownership"
        }
      });

      const schemaState = await pool.query<{
        isNullable: string;
        pendingBindingIndex: string;
      }>(`SELECT
          (SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'approval_requests'
              AND column_name = 'team_id') AS "isNullable",
          pg_get_indexdef(to_regclass('public.approval_requests_pending_binding_idx')) AS "pendingBindingIndex"`);
      expect(schemaState.rows[0]).toMatchObject({ isNullable: "NO" });
      expect(schemaState.rows[0]?.pendingBindingIndex).toContain("team_id");
    } finally {
      await pool.query('DELETE FROM "approval_requests" WHERE "id" = $1', [validApprovalId]);
      await db.delete(projects).where(eq(projects.id, projectId));
      await db.delete(teams).where(eq(teams.id, otherTeamId));
    }
  });
});
