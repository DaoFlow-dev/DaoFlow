import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { db } from "./connection";
import { controlPlaneRecoveryBundles } from "./schema/control-plane-recovery";
import { backupDestinations } from "./schema/destinations";

const destinationId = "bdst_recovery_migration";
const idempotencyKey = `sha256:${"d".repeat(64)}`;

async function seedDestination() {
  await db.insert(backupDestinations).values({
    id: destinationId,
    teamId: "team_foundation",
    name: "Recovery migration fixture",
    provider: "local",
    localPath: "/tmp/daoflow-recovery-migration"
  });
}

describe("control-plane recovery catalog migration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    await seedDestination();
  });

  it("stores versioned recovery metadata and protects referenced destinations", async () => {
    await db.insert(controlPlaneRecoveryBundles).values({
      id: "cprb_migration_fixture",
      ownerTeamId: "team_foundation",
      destinationId,
      status: "queued",
      formatVersion: 1,
      appVersion: "0.0.0-test",
      schemaVersion: "0034",
      keyFingerprint: "a".repeat(64),
      objectPrefix: "control-plane-recovery/v1/cprb_migration_fixture",
      bundleObjectPath: "control-plane-recovery/v1/cprb_migration_fixture/bundle.enc",
      manifestObjectPath: "control-plane-recovery/v1/cprb_migration_fixture/manifest.json",
      latestManifestObjectPath: "control-plane-recovery/v1/latest.json",
      idempotencyKey,
      requestedByUserId: "user_foundation_owner"
    });

    const [stored] = await db
      .select()
      .from(controlPlaneRecoveryBundles)
      .where(eq(controlPlaneRecoveryBundles.id, "cprb_migration_fixture"))
      .limit(1);

    expect(stored).toMatchObject({
      destinationId,
      formatVersion: 1,
      status: "queued",
      idempotencyKey,
      dispatchedAt: null,
      temporalRunId: null
    });
    await expect(
      db.delete(backupDestinations).where(eq(backupDestinations.id, destinationId))
    ).rejects.toThrow();
  });

  it("enforces one recovery bundle per owner request idempotency key", async () => {
    const paths = "control-plane-recovery/v1/cprb_idempotent";
    const values = {
      ownerTeamId: "team_foundation",
      destinationId,
      status: "queued" as const,
      formatVersion: 1,
      appVersion: "0.0.0-test",
      schemaVersion: "0035",
      keyFingerprint: "e".repeat(64),
      objectPrefix: paths,
      bundleObjectPath: `${paths}/bundle.enc`,
      manifestObjectPath: `${paths}/manifest.json`,
      latestManifestObjectPath: "control-plane-recovery/v1/latest.json",
      idempotencyKey,
      requestedByUserId: "user_foundation_owner"
    };

    await db.insert(controlPlaneRecoveryBundles).values({ ...values, id: "cprb_idempotent_one" });
    await expect(
      db.insert(controlPlaneRecoveryBundles).values({ ...values, id: "cprb_idempotent_two" })
    ).rejects.toThrow();
  });

  it("rejects unsupported statuses and format versions", async () => {
    await expect(
      db.execute(
        sql.raw(`
          INSERT INTO control_plane_recovery_bundles (
            id, owner_team_id, destination_id, status, format_version,
            app_version, schema_version, key_fingerprint, object_prefix,
            bundle_object_path, manifest_object_path, latest_manifest_object_path
          ) VALUES (
            'cprb_invalid_status', 'team_foundation', '${destinationId}', 'unsafe', 1,
            '0.0.0-test', '0034', '${"b".repeat(64)}',
            'control-plane-recovery/v1/test',
            'control-plane-recovery/v1/test/bundle.enc',
            'control-plane-recovery/v1/test/manifest.json',
            'control-plane-recovery/v1/latest.json'
          )
        `)
      )
    ).rejects.toThrow();

    await expect(
      db.execute(
        sql.raw(`
          INSERT INTO control_plane_recovery_bundles (
            id, owner_team_id, destination_id, status, format_version,
            app_version, schema_version, key_fingerprint, object_prefix,
            bundle_object_path, manifest_object_path, latest_manifest_object_path
          ) VALUES (
            'cprb_invalid_format', 'team_foundation', '${destinationId}', 'queued', 2,
            '0.0.0-test', '0034', '${"c".repeat(64)}',
            'control-plane-recovery/v2/test',
            'control-plane-recovery/v2/test/bundle.enc',
            'control-plane-recovery/v2/test/manifest.json',
            'control-plane-recovery/v1/latest.json'
          )
        `)
      )
    ).rejects.toThrow();
  });
});
