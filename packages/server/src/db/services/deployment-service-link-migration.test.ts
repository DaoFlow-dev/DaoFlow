import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../connection";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import { resetTestDatabaseWithControlPlane } from "../../test-db";

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

const targetServerId = "srv_foundation_1";

type MigrationJournal = {
  entries?: Array<{ tag?: string }>;
};

type MigrationScope = {
  projectId: string;
  environmentId: string;
  projectSlug: string;
  environmentSlug: string;
};

async function readDeploymentServiceLinkMigration() {
  const journal = JSON.parse(
    await readFile(
      fileURLToPath(new URL("../../../../../drizzle/meta/_journal.json", import.meta.url)),
      "utf8"
    )
  ) as MigrationJournal;
  const migrationTag = journal.entries?.find(({ tag }) =>
    tag?.endsWith("_backfill_deployment_service_link")
  )?.tag;

  if (!migrationTag) {
    throw new Error("The deployment service-link migration is missing from the Drizzle journal.");
  }

  return readFile(
    fileURLToPath(new URL(`../../../../../drizzle/${migrationTag}.sql`, import.meta.url)),
    "utf8"
  );
}

async function createMigrationScope(scope: MigrationScope) {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  await db.insert(projects).values({
    id: scope.projectId,
    name: `Deployment service-link migration ${scope.projectSlug}`,
    slug: scope.projectSlug,
    teamId: "team_foundation",
    sourceType: "compose",
    config: {},
    status: "active",
    defaultBranch: "main",
    autoDeploy: false,
    previewPolicy: "manual-approval",
    previewPolicyRevision: 1,
    createdByUserId: actor.requestedByUserId,
    createdAt,
    updatedAt: createdAt
  });

  await db.insert(environments).values({
    id: scope.environmentId,
    name: `Deployment service-link migration ${scope.environmentSlug}`,
    slug: scope.environmentSlug,
    projectId: scope.projectId,
    status: "active",
    config: { targetServerId },
    createdAt,
    updatedAt: createdAt
  });
}

async function insertService(input: {
  id: string;
  name: string;
  slug: string;
  projectId: string;
  environmentId: string;
  createdAt: Date;
  sourceType?: string;
}) {
  await db.insert(services).values({
    id: input.id,
    name: input.name,
    slug: input.slug,
    projectId: input.projectId,
    environmentId: input.environmentId,
    targetServerId,
    sourceType: input.sourceType ?? "compose",
    status: "inactive",
    config: {},
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  });
}

async function insertHistoricalDeployment(input: {
  id: string;
  projectId: string;
  environmentId: string;
  serviceName: string;
  createdAt: Date;
}) {
  await db.insert(deployments).values({
    id: input.id,
    projectId: input.projectId,
    environmentId: input.environmentId,
    targetServerId,
    // The migration test temporarily makes this nullable below.
    serviceId: "svc_migration_placeholder",
    serviceName: input.serviceName,
    sourceType: "compose",
    configSnapshot: {},
    status: "completed",
    conclusion: "succeeded",
    trigger: "user",
    ...actor,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  });

  await pool.query('UPDATE "deployments" SET "service_id" = NULL WHERE "id" = $1', [input.id]);
}

function expectedLegacyServiceId(deploymentId: string) {
  return `legacy_${createHash("md5").update(deploymentId).digest("hex").slice(0, 25)}`;
}

async function cleanupMigrationScope(projectId: string) {
  try {
    await pool.query('DELETE FROM "deployments" WHERE "project_id" = $1', [projectId]);
    await pool.query('DELETE FROM "projects" WHERE "id" = $1', [projectId]);
  } finally {
    await pool.query('ALTER TABLE "deployments" ALTER COLUMN "service_id" SET NOT NULL');
  }
}

describe("deployment service link migration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("links a deployment to its only historical-safe service", async () => {
    const scope = {
      projectId: "proj_dsl_migration_safe",
      environmentId: "env_dsl_migration_safe",
      projectSlug: "dsl-migration-safe",
      environmentSlug: "dsl-migration-safe"
    } satisfies MigrationScope;
    const deploymentId = "dep_dsl_migration_safe";
    const historicalServiceId = "svc_dsl_migration_historical";
    const replacementServiceId = "svc_dsl_migration_replacement";
    const deploymentCreatedAt = new Date("2026-01-02T00:00:00.000Z");

    try {
      await createMigrationScope(scope);
      await pool.query('ALTER TABLE "deployments" ALTER COLUMN "service_id" DROP NOT NULL');

      await insertService({
        id: historicalServiceId,
        name: "api",
        slug: "api-historical",
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        createdAt: deploymentCreatedAt
      });
      await insertService({
        id: replacementServiceId,
        name: "api",
        slug: "api-replacement",
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        createdAt: new Date("2026-01-03T00:00:00.000Z")
      });
      await insertHistoricalDeployment({
        id: deploymentId,
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        serviceName: "api",
        createdAt: deploymentCreatedAt
      });

      await pool.query(await readDeploymentServiceLinkMigration());

      const [deployment] = await db
        .select({ serviceId: deployments.serviceId })
        .from(deployments)
        .where(eq(deployments.id, deploymentId));
      expect(deployment?.serviceId).toBe(historicalServiceId);
    } finally {
      await cleanupMigrationScope(scope.projectId);
    }
  });

  it("gives orphaned, renamed, and replacement-only history deterministic legacy identities", async () => {
    const scope = {
      projectId: "proj_dsl_migration_legacy",
      environmentId: "env_dsl_migration_legacy",
      projectSlug: "dsl-migration-legacy",
      environmentSlug: "dsl-migration-legacy"
    } satisfies MigrationScope;
    const orphanedDeploymentId = "dep_dsl_migration_orphaned";
    const renamedDeploymentId = "dep_dsl_migration_renamed";
    const replacementOnlyDeploymentId = "dep_dsl_migration_replacement";
    const renamedServiceId = "svc_dsl_migration_renamed";
    const replacementServiceId = "svc_dsl_migration_later";
    const deploymentCreatedAt = new Date("2026-01-02T00:00:00.000Z");

    try {
      await createMigrationScope(scope);
      await pool.query('ALTER TABLE "deployments" ALTER COLUMN "service_id" DROP NOT NULL');

      // This service represents the original service after its mutable name was changed.
      await insertService({
        id: renamedServiceId,
        name: "renamed-api",
        slug: "renamed-api",
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      });
      await insertService({
        id: replacementServiceId,
        name: "api",
        slug: "api-replacement",
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        createdAt: new Date("2026-01-03T00:00:00.000Z")
      });
      await insertHistoricalDeployment({
        id: orphanedDeploymentId,
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        serviceName: "deleted-api",
        createdAt: deploymentCreatedAt
      });
      await insertHistoricalDeployment({
        id: renamedDeploymentId,
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        serviceName: "api",
        createdAt: deploymentCreatedAt
      });
      await insertHistoricalDeployment({
        id: replacementOnlyDeploymentId,
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        serviceName: "api",
        createdAt: new Date("2026-01-02T12:00:00.000Z")
      });

      await pool.query(await readDeploymentServiceLinkMigration());

      const rows = await db
        .select({ id: deployments.id, serviceId: deployments.serviceId })
        .from(deployments)
        .where(eq(deployments.projectId, scope.projectId));
      const serviceIds = new Map(rows.map((row) => [row.id, row.serviceId]));

      for (const deploymentId of [
        orphanedDeploymentId,
        renamedDeploymentId,
        replacementOnlyDeploymentId
      ]) {
        const serviceId = serviceIds.get(deploymentId);
        expect(serviceId).toHaveLength(32);
        expect(serviceId).toMatch(/^legacy_[0-9a-f]{25}$/);
        expect(serviceId).toBe(expectedLegacyServiceId(deploymentId));
      }
      expect(serviceIds.get(renamedDeploymentId)).not.toBe(renamedServiceId);
      expect(serviceIds.get(replacementOnlyDeploymentId)).not.toBe(replacementServiceId);
    } finally {
      await cleanupMigrationScope(scope.projectId);
    }
  });

  it("fails closed with the migration ambiguity error for multiple historical-safe matches", async () => {
    const scope = {
      projectId: "proj_dsl_migration_ambiguous",
      environmentId: "env_dsl_migration_ambiguous",
      projectSlug: "dsl-migration-ambiguous",
      environmentSlug: "dsl-migration-ambiguous"
    } satisfies MigrationScope;
    const deploymentId = "dep_dsl_migration_ambiguous";
    const deploymentCreatedAt = new Date("2026-01-02T00:00:00.000Z");

    try {
      await createMigrationScope(scope);
      await pool.query('ALTER TABLE "deployments" ALTER COLUMN "service_id" DROP NOT NULL');

      await insertService({
        id: "svc_dsl_migration_ambiguous_one",
        name: "api",
        slug: "api-history-one",
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      });
      await insertService({
        id: "svc_dsl_migration_ambiguous_two",
        name: "api",
        slug: "api-history-two",
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        createdAt: new Date("2026-01-01T12:00:00.000Z")
      });
      await insertHistoricalDeployment({
        id: deploymentId,
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        serviceName: "api",
        createdAt: deploymentCreatedAt
      });

      await expect(
        readDeploymentServiceLinkMigration().then((migration) => pool.query(migration))
      ).rejects.toThrow(
        "Cannot backfill deployments.service_id because one or more deployments match multiple historical services."
      );

      const [deployment] = await db
        .select({ serviceId: deployments.serviceId })
        .from(deployments)
        .where(eq(deployments.id, deploymentId));
      expect(deployment?.serviceId).toBeNull();
    } finally {
      await cleanupMigrationScope(scope.projectId);
    }
  });
});
