import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAppliedLineageIsPrefix,
  describeMigrationFailure,
  MigrationLineageError,
  normalizeAppliedMigrationRows,
  readLocalMigrationLineage,
  type LocalMigration
} from "./migration-lineage";

type FixtureMigration = {
  index: number;
  tag?: string;
  timestamp: number;
  sql?: string;
};

const fixtureDirectories: string[] = [];

function tagFor(index: number) {
  return `${String(index).padStart(4, "0")}_migration_${index}`;
}

async function createMigrationFixture(entries: FixtureMigration[]) {
  const migrationsFolder = await mkdtemp(path.join(tmpdir(), "daoflow-migration-lineage-"));
  fixtureDirectories.push(migrationsFolder);
  await mkdir(path.join(migrationsFolder, "meta"), { recursive: true });
  await writeFile(
    path.join(migrationsFolder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: entries.map((entry) => ({
        idx: entry.index,
        version: "7",
        when: entry.timestamp,
        tag: entry.tag ?? tagFor(entry.index),
        breakpoints: true
      }))
    })
  );
  await Promise.all(
    entries.map((entry) =>
      writeFile(
        path.join(migrationsFolder, `${entry.tag ?? tagFor(entry.index)}.sql`),
        entry.sql ?? `CREATE TABLE migration_${entry.index} ();\n`
      )
    )
  );
  return migrationsFolder;
}

function localMigration(index: number, createdAt: number): LocalMigration {
  const sql = `CREATE TABLE migration_${index} ();\n`;
  return {
    index,
    tag: tagFor(index),
    createdAt,
    hash: createHash("sha256").update(sql).digest("hex")
  };
}

function appliedPrefix(local: readonly LocalMigration[], count: number) {
  return local.slice(0, count).map((migration, position) => ({
    id: position + 1,
    hash: migration.hash,
    createdAt: migration.createdAt
  }));
}

describe("migration lineage", () => {
  afterEach(async () => {
    await Promise.all(
      fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
    );
  });

  it("accepts an exact applied prefix when the image has newer migrations", () => {
    const local = [localMigration(0, 100), localMigration(1, 200), localMigration(2, 300)];

    expect(() => assertAppliedLineageIsPrefix(local, appliedPrefix(local, 2))).not.toThrow();
  });

  it("rejects a database ledger that is ahead of the local image", () => {
    const local = [localMigration(0, 100)];
    const applied = [...appliedPrefix(local, 1), { id: 2, hash: "f".repeat(64), createdAt: 200 }];

    expect(() => assertAppliedLineageIsPrefix(local, applied)).toThrow(
      expect.objectContaining({ reason: "DB_AHEAD" })
    );
  });

  it("rejects an applied migration whose source hash changed", () => {
    const local = [localMigration(0, 100)];
    const applied = [{ id: 1, hash: "f".repeat(64), createdAt: 100 }];

    try {
      assertAppliedLineageIsPrefix(local, applied);
      throw new Error("expected a lineage mismatch");
    } catch (error) {
      expect(error).toMatchObject({
        code: "MIGRATION_LINEAGE_MISMATCH",
        reason: "DB_HASH_CHANGED",
        details: {
          position: 0,
          expectedTag: "0000_migration_0",
          expectedCreatedAt: 100,
          appliedId: 1,
          appliedCreatedAt: 100
        }
      });
      expect(describeMigrationFailure(error)).toBe(
        "MIGRATION_LINEAGE_MISMATCH: DB_HASH_CHANGED (appliedCreatedAt=100, appliedHash=ffffffffffff, appliedId=1, expectedCreatedAt=100, expectedHash=fc9e17526af7, expectedTag=0000_migration_0, position=0)"
      );
    }
  });

  it("rejects an applied ledger with a missing middle migration", () => {
    const local = [localMigration(0, 100), localMigration(1, 200), localMigration(2, 300)];
    const applied = [appliedPrefix(local, 1)[0], { id: 2, ...local[2] }];

    expect(() => assertAppliedLineageIsPrefix(local, applied)).toThrow(
      expect.objectContaining({ reason: "DB_MISSING_MIDDLE" })
    );
  });

  it("rejects duplicate and out-of-order database ledger entries", () => {
    const hash = localMigration(0, 100).hash;

    expect(() =>
      normalizeAppliedMigrationRows([
        { id: 1, hash, created_at: "100" },
        { id: 2, hash, created_at: "100" }
      ])
    ).toThrow(expect.objectContaining({ reason: "DB_DUPLICATE_TIMESTAMP" }));
    expect(() =>
      normalizeAppliedMigrationRows([
        { id: 1, hash, created_at: "200" },
        { id: 2, hash, created_at: "100" }
      ])
    ).toThrow(expect.objectContaining({ reason: "DB_ENTRY_OUT_OF_ORDER" }));
  });

  it("rejects duplicate and out-of-order entries in the local journal", async () => {
    const duplicateIndexFolder = await createMigrationFixture([
      { index: 0, timestamp: 100 },
      { index: 0, tag: tagFor(1), timestamp: 200 }
    ]);
    const timestampOutOfOrderFolder = await createMigrationFixture([
      { index: 0, timestamp: 200 },
      { index: 1, timestamp: 100 }
    ]);

    expect(() => readLocalMigrationLineage(duplicateIndexFolder)).toThrow(
      expect.objectContaining({ reason: "LOCAL_DUPLICATE_INDEX" })
    );
    expect(() => readLocalMigrationLineage(timestampOutOfOrderFolder)).toThrow(
      expect.objectContaining({ reason: "LOCAL_TIMESTAMP_OUT_OF_ORDER" })
    );
  });

  it("rejects local tags whose numeric prefixes do not match their journal index", async () => {
    const migrationsFolder = await createMigrationFixture([
      { index: 0, timestamp: 100 },
      { index: 1, tag: "0002_migration_2", timestamp: 200 }
    ]);

    expect(() => readLocalMigrationLineage(migrationsFolder)).toThrow(
      expect.objectContaining({ reason: "LOCAL_PREFIX_OUT_OF_ORDER" })
    );
  });

  it("treats a missing migrations directory as a lineage mismatch", () => {
    expect(() => readLocalMigrationLineage(path.join(tmpdir(), "does-not-exist-daoflow"))).toThrow(
      expect.objectContaining({
        code: "MIGRATION_LINEAGE_MISMATCH",
        reason: "LOCAL_MIGRATIONS_MISSING"
      })
    );
  });

  it("exposes a stable mismatch error shape", () => {
    const error = new MigrationLineageError("DB_UNKNOWN_ENTRY", { position: 1 });

    expect(error).toMatchObject({
      code: "MIGRATION_LINEAGE_MISMATCH",
      reason: "DB_UNKNOWN_ENTRY",
      details: { position: 1 }
    });
  });

  it("formats only whitelisted safe migration detail fields", () => {
    const error = new MigrationLineageError("DB_UNKNOWN_ENTRY", {
      position: 1,
      databaseUrl: "postgresql://not-safe",
      rawSql: "SELECT * FROM sensitive"
    });

    expect(describeMigrationFailure(error)).toBe(
      "MIGRATION_LINEAGE_MISMATCH: DB_UNKNOWN_ENTRY (position=1)"
    );
  });
});
