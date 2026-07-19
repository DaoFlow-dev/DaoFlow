import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppliedMigration, type LocalMigration } from "./migration-lineage";
import { migrationRunnerTestHooks, runMigrationCoordinator } from "./migration-runner";
import { createPool, deferred } from "./migration-runner-test-support";

type FixtureMigration = {
  index: number;
  timestamp: number;
  sql?: string;
};

type FailureMarkerReason =
  "MIGRATION_OPERATION_FAILED" | "POST_MIGRATION_VERIFICATION_FAILED" | "MIGRATION_RETRY_FAILED";
type StoredFailureMarker = { createdAt: number; hash: string; reason: FailureMarkerReason };

type FakeDatabase = {
  ledgerExists: boolean;
  ledger: AppliedMigration[];
  publicTableCount: number;
  controlTableExists?: boolean;
  failureMarker?: StoredFailureMarker | null;
  failMarkerWrite?: boolean;
};

const fixtureDirectories: string[] = [];

function tagFor(index: number) {
  return `${String(index).padStart(4, "0")}_migration_${index}`;
}

async function createMigrationFixture(entries: FixtureMigration[]) {
  const migrationsFolder = await mkdtemp(path.join(tmpdir(), "daoflow-migration-runner-"));
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
        tag: tagFor(entry.index),
        breakpoints: true
      }))
    })
  );
  await Promise.all(
    entries.map((entry) =>
      writeFile(
        path.join(migrationsFolder, `${tagFor(entry.index)}.sql`),
        entry.sql ?? `CREATE TABLE migration_${entry.index} ();\n`
      )
    )
  );
  return migrationsFolder;
}

function localMigrations(entries: FixtureMigration[]): LocalMigration[] {
  return entries.map((entry) => {
    const source = entry.sql ?? `CREATE TABLE migration_${entry.index} ();\n`;
    return {
      index: entry.index,
      tag: tagFor(entry.index),
      createdAt: entry.timestamp,
      hash: createHash("sha256").update(source).digest("hex")
    };
  });
}

function appliedPrefix(local: readonly LocalMigration[], count: number): AppliedMigration[] {
  return local.slice(0, count).map((migration, position) => ({
    id: position + 1,
    hash: migration.hash,
    createdAt: migration.createdAt
  }));
}

function markerFor(local: readonly LocalMigration[], reason: FailureMarkerReason) {
  return { createdAt: local[0].createdAt, hash: local[0].hash, reason };
}

async function singleMigrationScenario(overrides: Partial<FakeDatabase> = {}) {
  const entries = [{ index: 0, timestamp: 100 }];
  const migrationsFolder = await createMigrationFixture(entries);
  const local = localMigrations(entries);
  const database: FakeDatabase = {
    ledgerExists: false,
    ledger: [],
    publicTableCount: 0,
    ...overrides
  };
  return { migrationsFolder, local, database };
}

function createClient(database: FakeDatabase) {
  const queries: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (statement: string, values?: unknown[]) => {
    await Promise.resolve();
    queries.push(statement);
    if (statement === migrationRunnerTestHooks.acquireAdvisoryLockSql) {
      return { rows: [{ migration_lock_acquired: "" }] };
    }
    if (statement === migrationRunnerTestHooks.releaseAdvisoryLockSql) {
      return { rows: [{ migration_lock_released: true }] };
    }
    if (statement === "SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger") {
      return { rows: [{ ledger: database.ledgerExists ? "drizzle.__drizzle_migrations" : null }] };
    }
    if (statement === migrationRunnerTestHooks.readLedgerSql) {
      return {
        rows: database.ledger.map((entry) => ({
          id: entry.id,
          hash: entry.hash,
          created_at: String(entry.createdAt)
        }))
      };
    }
    if (statement === migrationRunnerTestHooks.publicTableCountSql) {
      return { rows: [{ table_count: database.publicTableCount }] };
    }
    if (statement === migrationRunnerTestHooks.controlRegclassSql) {
      return {
        rows: [
          {
            control_table: database.controlTableExists
              ? "drizzle.__daoflow_migration_control"
              : null
          }
        ]
      };
    }
    if (statement === migrationRunnerTestHooks.ensureDrizzleSchemaSql) {
      return { rows: [] };
    }
    if (statement === migrationRunnerTestHooks.ensureControlTableSql) {
      database.controlTableExists = true;
      return { rows: [] };
    }
    if (statement === migrationRunnerTestHooks.readFailureMarkerSql) {
      return {
        rows: database.failureMarker
          ? [
              {
                migration_created_at: String(database.failureMarker.createdAt),
                migration_hash: database.failureMarker.hash,
                failure_reason: database.failureMarker.reason,
                failed_at: new Date()
              }
            ]
          : []
      };
    }
    if (statement === migrationRunnerTestHooks.clearFailureMarkerSql) {
      database.failureMarker = null;
      return { rows: [] };
    }
    if (statement === migrationRunnerTestHooks.upsertFailureMarkerSql) {
      if (database.failMarkerWrite) throw new Error("marker storage unavailable");
      database.controlTableExists = true;
      database.failureMarker = {
        createdAt: Number(values?.[0]),
        hash: String(values?.[1]),
        reason: values?.[2] as NonNullable<FakeDatabase["failureMarker"]>["reason"]
      };
      return { rows: [] };
    }
    if (statement === migrationRunnerTestHooks.enableVectorSql) {
      return { rows: [] };
    }
    throw new Error("unexpected query");
  });

  return {
    client: { query, release } as unknown as pg.PoolClient,
    queries,
    release
  };
}

describe("migration coordinator", () => {
  afterEach(async () => {
    delete process.env.DAOFLOW_RETRY_FAILED_MIGRATION;
    await Promise.all(fixtureDirectories.splice(0).map((dir) => rm(dir, { recursive: true })));
  });

  it("does not invoke migration or enable vector when preflight lineage mismatches", async () => {
    const entries = [
      { index: 0, timestamp: 100 },
      { index: 1, timestamp: 200 }
    ];
    const migrationsFolder = await createMigrationFixture(entries);
    const local = localMigrations(entries);
    const database: FakeDatabase = {
      ledgerExists: true,
      ledger: [...appliedPrefix(local, 2), { id: 3, hash: "f".repeat(64), createdAt: 300 }],
      publicTableCount: 0
    };
    const { client, queries } = createClient(database);
    const { pool } = createPool(client);
    const runDrizzleMigrations = vi.fn();

    await expect(
      runMigrationCoordinator({ migrationsFolder, pool, runDrizzleMigrations })
    ).rejects.toMatchObject({ code: "MIGRATION_LINEAGE_MISMATCH", reason: "DB_AHEAD" });

    expect(runDrizzleMigrations).not.toHaveBeenCalled();
    expect(queries).not.toContain(migrationRunnerTestHooks.enableVectorSql);
  });

  it("rejects a ledger-free database that already has public application tables", async () => {
    const entries = [{ index: 0, timestamp: 100 }];
    const migrationsFolder = await createMigrationFixture(entries);
    const database: FakeDatabase = { ledgerExists: false, ledger: [], publicTableCount: 1 };
    const { client, queries } = createClient(database);
    const { pool } = createPool(client);
    const runDrizzleMigrations = vi.fn();

    await expect(
      runMigrationCoordinator({ migrationsFolder, pool, runDrizzleMigrations })
    ).rejects.toMatchObject({ code: "MIGRATION_LINEAGE_MISMATCH", reason: "SCHEMA_NOT_EMPTY" });

    expect(runDrizzleMigrations).not.toHaveBeenCalled();
    expect(queries).not.toContain(migrationRunnerTestHooks.enableVectorSql);
  });

  it("uses one client through preflight, migration, post-verification, and release", async () => {
    const scenario = await singleMigrationScenario();
    const { client, queries, release } = createClient(scenario.database);
    const { pool } = createPool(client);
    const runDrizzleMigrations = vi.fn((receivedClient: pg.PoolClient) => {
      expect(receivedClient).toBe(client);
      scenario.database.ledgerExists = true;
      scenario.database.ledger = appliedPrefix(scenario.local, 1);
      return Promise.resolve();
    });

    await runMigrationCoordinator({
      migrationsFolder: scenario.migrationsFolder,
      pool,
      runDrizzleMigrations
    });

    expect(runDrizzleMigrations).toHaveBeenCalledOnce();
    expect(queries.indexOf(migrationRunnerTestHooks.acquireAdvisoryLockSql)).toBeLessThan(
      queries.indexOf(migrationRunnerTestHooks.enableVectorSql)
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("records the first failed attempt and blocks an unchanged restart before DDL", async () => {
    const { migrationsFolder, local, database } = await singleMigrationScenario();
    const first = createClient(database);
    const firstMigration = vi.fn().mockRejectedValue(new Error("unsafe failure text"));

    await expect(
      runMigrationCoordinator({
        migrationsFolder,
        pool: createPool(first.client).pool,
        runDrizzleMigrations: firstMigration
      })
    ).rejects.toMatchObject({
      code: "MIGRATION_APPLY_FAILED",
      reason: "MIGRATION_OPERATION_FAILED"
    });

    expect(firstMigration).toHaveBeenCalledOnce();
    expect(database.failureMarker).toEqual(markerFor(local, "MIGRATION_OPERATION_FAILED"));
    expect(first.queries.indexOf(migrationRunnerTestHooks.ensureControlTableSql)).toBeLessThan(
      first.queries.indexOf(migrationRunnerTestHooks.enableVectorSql)
    );

    const second = createClient(database);
    const secondMigration = vi.fn(),
      secondEnableVector = vi.fn();
    await expect(
      runMigrationCoordinator({
        migrationsFolder,
        pool: createPool(second.client).pool,
        enableVector: secondEnableVector,
        runDrizzleMigrations: secondMigration
      })
    ).rejects.toMatchObject({
      code: "MIGRATION_APPLY_FAILED",
      reason: "PREVIOUS_MIGRATION_ATTEMPT_FAILED"
    });

    expect(secondEnableVector).not.toHaveBeenCalled();
    expect(secondMigration).not.toHaveBeenCalled();
  });

  it("allows an explicitly requested retry after a previous retry failed", async () => {
    const scenario = await singleMigrationScenario({ controlTableExists: true });
    scenario.database.failureMarker = markerFor(scenario.local, "MIGRATION_RETRY_FAILED");
    const { client } = createClient(scenario.database);
    const runDrizzleMigrations = vi.fn(() => {
      scenario.database.ledgerExists = true;
      scenario.database.ledger = appliedPrefix(scenario.local, 1);
      return Promise.resolve();
    });

    await runMigrationCoordinator({
      migrationsFolder: scenario.migrationsFolder,
      pool: createPool(client).pool,
      retryFailedMigration: true,
      runDrizzleMigrations
    });

    expect(runDrizzleMigrations).toHaveBeenCalledOnce();
    expect(scenario.database.failureMarker).toBeNull();
  });

  it("does not let a process-wide environment flag bypass an explicit caller decision", async () => {
    const scenario = await singleMigrationScenario({ controlTableExists: true });
    scenario.database.failureMarker = markerFor(scenario.local, "MIGRATION_OPERATION_FAILED");
    process.env.DAOFLOW_RETRY_FAILED_MIGRATION = "true";
    const { client } = createClient(scenario.database);
    const runDrizzleMigrations = vi.fn();

    await expect(
      runMigrationCoordinator({
        migrationsFolder: scenario.migrationsFolder,
        pool: createPool(client).pool,
        runDrizzleMigrations
      })
    ).rejects.toMatchObject({
      code: "MIGRATION_APPLY_FAILED",
      reason: "PREVIOUS_MIGRATION_ATTEMPT_FAILED"
    });

    expect(runDrizzleMigrations).not.toHaveBeenCalled();
  });

  it("clears a marker after the migration is manually present in the ledger", async () => {
    const scenario = await singleMigrationScenario({
      ledgerExists: true,
      controlTableExists: true
    });
    scenario.database.ledger = appliedPrefix(scenario.local, 1);
    scenario.database.failureMarker = markerFor(scenario.local, "MIGRATION_OPERATION_FAILED");
    const { client } = createClient(scenario.database);

    await runMigrationCoordinator({
      migrationsFolder: scenario.migrationsFolder,
      pool: createPool(client).pool,
      runDrizzleMigrations: () => {
        expect(scenario.database.failureMarker).toBeNull();
        return Promise.resolve();
      }
    });

    expect(scenario.database.failureMarker).toBeNull();
  });

  it("blocks a marker that conflicts with the local pending lineage", async () => {
    const scenario = await singleMigrationScenario({ controlTableExists: true });
    scenario.database.failureMarker = {
      createdAt: 999,
      hash: "f".repeat(64),
      reason: "MIGRATION_OPERATION_FAILED"
    };
    const { client } = createClient(scenario.database);
    const runDrizzleMigrations = vi.fn();

    await expect(
      runMigrationCoordinator({
        migrationsFolder: scenario.migrationsFolder,
        pool: createPool(client).pool,
        runDrizzleMigrations
      })
    ).rejects.toMatchObject({
      code: "MIGRATION_APPLY_FAILED",
      reason: "MIGRATION_RECOVERY_REQUIRED"
    });

    expect(runDrizzleMigrations).not.toHaveBeenCalled();
  });

  it("returns a safe recording failure and discards the client", async () => {
    const scenario = await singleMigrationScenario({ failMarkerWrite: true });
    const { client, release } = createClient(scenario.database);

    await expect(
      runMigrationCoordinator({
        migrationsFolder: scenario.migrationsFolder,
        pool: createPool(client).pool,
        runDrizzleMigrations: async () => Promise.reject(new Error("raw SQL must not escape"))
      })
    ).rejects.toMatchObject({
      code: "MIGRATION_APPLY_FAILED",
      reason: "MIGRATION_FAILURE_RECORDING_FAILED"
    });

    expect(release).toHaveBeenCalledWith(expect.any(Error));
  });

  it("fails safely when migration returns without a complete verified ledger", async () => {
    const entries = [
      { index: 0, timestamp: 100 },
      { index: 1, timestamp: 200 }
    ];
    const migrationsFolder = await createMigrationFixture(entries);
    const local = localMigrations(entries);
    const database: FakeDatabase = {
      ledgerExists: true,
      ledger: appliedPrefix(local, 1),
      publicTableCount: 0
    };
    const { client, release } = createClient(database);
    const { pool } = createPool(client);

    await expect(
      runMigrationCoordinator({
        migrationsFolder,
        pool,
        runDrizzleMigrations: () => Promise.resolve()
      })
    ).rejects.toMatchObject({
      code: "MIGRATION_LINEAGE_MISMATCH",
      reason: "DB_NOT_FULLY_MIGRATED"
    });

    expect(release).toHaveBeenCalledOnce();
  });

  it("serializes two migration attempts behind the session advisory lock", async () => {
    const entries = [{ index: 0, timestamp: 100 }];
    const migrationsFolder = await createMigrationFixture(entries);
    const local = localMigrations(entries);
    const database: FakeDatabase = { ledgerExists: false, ledger: [], publicTableCount: 0 };
    let locked = false;
    const waiters: Array<() => void> = [];

    function createSerializedClient() {
      const base = createClient(database);
      const query = vi.fn(async (statement: string) => {
        if (statement === migrationRunnerTestHooks.acquireAdvisoryLockSql) {
          if (locked) {
            await new Promise<void>((resolve) => waiters.push(resolve));
          }
          locked = true;
          return { rows: [] };
        }
        if (statement === migrationRunnerTestHooks.releaseAdvisoryLockSql) {
          locked = false;
          waiters.shift()?.();
          return { rows: [] };
        }
        return (base.client.query as unknown as (queryText: string) => Promise<unknown>)(statement);
      });
      return { ...base, client: { query, release: base.release } as unknown as pg.PoolClient };
    }

    const first = createSerializedClient();
    const second = createSerializedClient();
    const connect = vi
      .fn()
      .mockResolvedValueOnce(first.client)
      .mockResolvedValueOnce(second.client);
    const pool = { connect } as unknown as pg.Pool;
    const firstMigrationStarted = deferred();
    const releaseFirstMigration = deferred();
    const firstMigration = vi.fn(async () => {
      firstMigrationStarted.resolve();
      await releaseFirstMigration.promise;
      database.ledgerExists = true;
      database.ledger = appliedPrefix(local, local.length);
    });
    const secondMigration = vi.fn(() => Promise.resolve());

    const firstAttempt = runMigrationCoordinator({
      migrationsFolder,
      pool,
      runDrizzleMigrations: firstMigration
    });
    await firstMigrationStarted.promise;
    const secondAttempt = runMigrationCoordinator({
      migrationsFolder,
      pool,
      runDrizzleMigrations: secondMigration
    });

    await Promise.resolve();
    expect(secondMigration).not.toHaveBeenCalled();

    releaseFirstMigration.resolve();
    await Promise.all([firstAttempt, secondAttempt]);

    expect(secondMigration).toHaveBeenCalledOnce();
    expect(first.release).toHaveBeenCalledOnce();
    expect(second.release).toHaveBeenCalledOnce();
  });
});
