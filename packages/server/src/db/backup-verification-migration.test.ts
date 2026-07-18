import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { db } from "./connection";
import { backupRuns } from "./schema/storage";

describe("backup verification history migration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("moves legacy remote-presence timestamps out of restore verification", async () => {
    const legacyTimestamp = new Date("2026-07-01T12:00:00.000Z");
    await db.insert(backupRuns).values({
      id: "brun_legacy_verification",
      policyId: "bpol_foundation_volume_daily",
      status: "succeeded",
      artifactPath: "legacy/backup.tar",
      verifiedAt: legacyTimestamp,
      createdAt: legacyTimestamp
    });

    const migration = await readFile(
      fileURLToPath(
        new URL(
          "../../../../drizzle/0032_distinguish_artifact_checks_from_restore_verification.sql",
          import.meta.url
        )
      ),
      "utf8"
    );
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration));

    const [run] = await db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.id, "brun_legacy_verification"))
      .limit(1);

    expect(run?.artifactCheckedAt?.toISOString()).toBe(legacyTimestamp.toISOString());
    expect(run?.verifiedAt).toBeNull();
  });

  it("rejects invalid restore modes and verification evidence on normal restores", async () => {
    await expect(
      db.execute(
        sql.raw(`
        INSERT INTO backup_restores (id, backup_run_id, mode, status)
        VALUES ('brest_invalid_mode', 'brun_foundation_volume_success', 'unsafe', 'queued')
      `)
      )
    ).rejects.toThrow();

    await expect(
      db.execute(
        sql.raw(`
        INSERT INTO backup_restores (
          id,
          backup_run_id,
          mode,
          status,
          verification_result
        ) VALUES (
          'brest_invalid_evidence',
          'brun_foundation_volume_success',
          'restore',
          'succeeded',
          '{"success":true}'::jsonb
        )
      `)
      )
    ).rejects.toThrow();
  });
});
