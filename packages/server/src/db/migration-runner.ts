import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import {
  assertAppliedLineageIsComplete,
  assertAppliedLineageIsPrefix,
  MigrationApplyError,
  MigrationLineageError,
  normalizeAppliedMigrationRows,
  readLocalMigrationLineage,
  type AppliedMigration,
  type LocalMigration,
  type MigrationLineageDetails
} from "./migration-lineage";

const ADVISORY_LOCK_NAMESPACE = 1_145_130_822;
const ACQUIRE_ADVISORY_LOCK_SQL =
  "SELECT pg_advisory_lock($1::integer, hashtext(current_database())) AS migration_lock_acquired";
const RELEASE_ADVISORY_LOCK_SQL =
  "SELECT pg_advisory_unlock($1::integer, hashtext(current_database())) AS migration_lock_released";
const LEDGER_REGCLASS_SQL = "SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger";
const READ_LEDGER_SQL =
  "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC";
const PUBLIC_TABLE_COUNT_SQL =
  "SELECT count(*)::integer AS table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'";
const ENABLE_VECTOR_SQL = "CREATE EXTENSION IF NOT EXISTS vector";
const CONTROL_REGCLASS_SQL =
  "SELECT to_regclass('drizzle.__daoflow_migration_control') AS control_table";
const ENSURE_DRIZZLE_SCHEMA_SQL = "CREATE SCHEMA IF NOT EXISTS drizzle";
const ENSURE_CONTROL_TABLE_SQL = `CREATE TABLE IF NOT EXISTS drizzle.__daoflow_migration_control (
  singleton_id smallint PRIMARY KEY CHECK (singleton_id = 1),
  migration_created_at bigint NOT NULL,
  migration_hash text NOT NULL,
  failure_reason text NOT NULL,
  failed_at timestamptz NOT NULL
)`;
const READ_FAILURE_MARKER_SQL =
  "SELECT migration_created_at, migration_hash, failure_reason, failed_at FROM drizzle.__daoflow_migration_control WHERE singleton_id = 1";
const CLEAR_FAILURE_MARKER_SQL =
  "DELETE FROM drizzle.__daoflow_migration_control WHERE singleton_id = 1";
const UPSERT_FAILURE_MARKER_SQL = `INSERT INTO drizzle.__daoflow_migration_control
  (singleton_id, migration_created_at, migration_hash, failure_reason, failed_at)
  VALUES (1, $1, $2, $3, now())
  ON CONFLICT (singleton_id) DO UPDATE SET
    migration_created_at = EXCLUDED.migration_created_at,
    migration_hash = EXCLUDED.migration_hash,
    failure_reason = EXCLUDED.failure_reason,
    failed_at = EXCLUDED.failed_at`;

const FAILURE_MARKER_REASONS = [
  "MIGRATION_OPERATION_FAILED",
  "POST_MIGRATION_VERIFICATION_FAILED",
  "MIGRATION_RETRY_FAILED"
] as const;
type FailureMarkerReason = (typeof FAILURE_MARKER_REASONS)[number];
type FailureMarker = { createdAt: number; hash: string; reason: FailureMarkerReason };

type LedgerState = {
  exists: boolean;
  entries: AppliedMigration[];
};

export type MigrationCoordinatorOptions = {
  migrationsFolder: string;
  pool: Pick<pg.Pool, "connect">;
  enableVector?: (client: pg.PoolClient) => Promise<void>;
  retryFailedMigration?: boolean;
  runDrizzleMigrations?: (client: pg.PoolClient, migrationsFolder: string) => Promise<void>;
};

function migrationDetails(migration: LocalMigration | undefined): MigrationLineageDetails {
  return migration
    ? {
        expectedTag: migration.tag,
        expectedCreatedAt: migration.createdAt,
        expectedHash: migration.hash.slice(0, 12)
      }
    : {};
}

function recoveryDetails(
  pending: LocalMigration | undefined,
  marker: FailureMarker
): MigrationLineageDetails {
  return {
    ...migrationDetails(pending),
    markerCreatedAt: marker.createdAt,
    markerHash: marker.hash.slice(0, 12)
  };
}

async function readLedger(client: pg.PoolClient): Promise<LedgerState> {
  const registration = await client.query<{ ledger: string | null }>(LEDGER_REGCLASS_SQL);
  if (!registration.rows[0]?.ledger) {
    return { exists: false, entries: [] };
  }

  const result = await client.query<Record<string, unknown>>(READ_LEDGER_SQL);
  return {
    exists: true,
    entries: normalizeAppliedMigrationRows(result.rows)
  };
}

async function assertEmptyApplicationSchema(client: pg.PoolClient) {
  const result = await client.query<{ table_count: number | string }>(PUBLIC_TABLE_COUNT_SQL);
  const tableCount = Number(result.rows[0]?.table_count ?? 0);
  if (!Number.isSafeInteger(tableCount) || tableCount > 0) {
    throw new MigrationLineageError("SCHEMA_NOT_EMPTY", {
      tableCount: Number.isSafeInteger(tableCount) ? tableCount : -1
    });
  }
}

async function controlTableExists(client: pg.PoolClient) {
  const result = await client.query<{ control_table: string | null }>(CONTROL_REGCLASS_SQL);
  return Boolean(result.rows[0]?.control_table);
}

async function ensureControlTable(client: pg.PoolClient) {
  await client.query(ENSURE_DRIZZLE_SCHEMA_SQL);
  await client.query(ENSURE_CONTROL_TABLE_SQL);
}

async function readFailureMarker(client: pg.PoolClient): Promise<FailureMarker | undefined> {
  const result = await client.query<Record<string, unknown>>(READ_FAILURE_MARKER_SQL);
  const row = result.rows[0];
  if (!row) return undefined;

  const createdAt = Number(row.migration_created_at);
  const hash = row.migration_hash;
  const reason = row.failure_reason;
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0 ||
    typeof hash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(hash) ||
    typeof reason !== "string" ||
    !FAILURE_MARKER_REASONS.includes(reason as FailureMarkerReason)
  ) {
    throw new MigrationApplyError("MIGRATION_RECOVERY_REQUIRED");
  }
  return { createdAt, hash, reason: reason as FailureMarkerReason };
}

async function clearFailureMarker(client: pg.PoolClient) {
  await client.query(CLEAR_FAILURE_MARKER_SQL);
}

async function recordFailureMarker(
  client: pg.PoolClient,
  pending: LocalMigration,
  reason: FailureMarkerReason
) {
  await client.query(UPSERT_FAILURE_MARKER_SQL, [pending.createdAt, pending.hash, reason]);
}

async function reconcileFailureMarker(input: {
  client: pg.PoolClient;
  marker: FailureMarker;
  local: readonly LocalMigration[];
  appliedCount: number;
  pending: LocalMigration | undefined;
  retryRequested: boolean;
}) {
  const markerIndex = input.local.findIndex(
    (migration) => migration.createdAt === input.marker.createdAt
  );
  const markerMigration = input.local[markerIndex];
  if (!markerMigration || markerMigration.hash !== input.marker.hash) {
    throw new MigrationApplyError(
      "MIGRATION_RECOVERY_REQUIRED",
      recoveryDetails(input.pending, input.marker)
    );
  }
  if (markerIndex < input.appliedCount) {
    await clearFailureMarker(input.client);
    return false;
  }
  if (markerIndex !== input.appliedCount || !input.pending) {
    throw new MigrationApplyError(
      "MIGRATION_RECOVERY_REQUIRED",
      recoveryDetails(input.pending, input.marker)
    );
  }
  if (input.retryRequested) {
    await clearFailureMarker(input.client);
    return true;
  }
  throw new MigrationApplyError(
    "PREVIOUS_MIGRATION_ATTEMPT_FAILED",
    recoveryDetails(input.pending, input.marker)
  );
}

async function defaultEnableVector(client: pg.PoolClient) {
  await client.query(ENABLE_VECTOR_SQL);
}

async function defaultRunDrizzleMigrations(client: pg.PoolClient, migrationsFolder: string) {
  await migrate(drizzle(client), { migrationsFolder });
}

function asSafeMigrationError(error: unknown) {
  if (error instanceof MigrationLineageError || error instanceof MigrationApplyError) {
    return error;
  }

  return new MigrationApplyError("MIGRATION_OPERATION_FAILED");
}

export async function runMigrationCoordinator(input: MigrationCoordinatorOptions): Promise<void> {
  const enableVector = input.enableVector ?? defaultEnableVector;
  const runDrizzleMigrations = input.runDrizzleMigrations ?? defaultRunDrizzleMigrations;
  let client: pg.PoolClient | undefined;
  let advisoryLockHeld = false;
  let failure: Error | undefined;
  let discardClient = false;
  let pendingMigration: LocalMigration | undefined;
  let controlReady = false;
  let failureMarkerReason: FailureMarkerReason | undefined;
  let retryAttempted = false;

  try {
    client = await input.pool.connect();
    await client.query(ACQUIRE_ADVISORY_LOCK_SQL, [ADVISORY_LOCK_NAMESPACE]);
    advisoryLockHeld = true;

    const localMigrations: LocalMigration[] = readLocalMigrationLineage(input.migrationsFolder);
    const preflightLedger = await readLedger(client);
    assertAppliedLineageIsPrefix(localMigrations, preflightLedger.entries);
    if (!preflightLedger.exists || preflightLedger.entries.length === 0) {
      await assertEmptyApplicationSchema(client);
    }

    pendingMigration = localMigrations[preflightLedger.entries.length];
    controlReady = await controlTableExists(client);
    if (pendingMigration && !controlReady) {
      await ensureControlTable(client);
      controlReady = true;
    }
    const marker = controlReady ? await readFailureMarker(client) : undefined;
    if (marker) {
      retryAttempted = await reconcileFailureMarker({
        client,
        marker,
        local: localMigrations,
        appliedCount: preflightLedger.entries.length,
        pending: pendingMigration,
        retryRequested: input.retryFailedMigration ?? false
      });
    }

    try {
      await enableVector(client);
      await runDrizzleMigrations(client, input.migrationsFolder);
    } catch (error) {
      failureMarkerReason = retryAttempted
        ? "MIGRATION_RETRY_FAILED"
        : "MIGRATION_OPERATION_FAILED";
      throw error;
    }

    try {
      const postMigrationLedger = await readLedger(client);
      assertAppliedLineageIsComplete(localMigrations, postMigrationLedger.entries);
    } catch (error) {
      failureMarkerReason = retryAttempted
        ? "MIGRATION_RETRY_FAILED"
        : "POST_MIGRATION_VERIFICATION_FAILED";
      throw error;
    }
    if (controlReady) await clearFailureMarker(client);
  } catch (error) {
    failure = asSafeMigrationError(error);
    if (client && pendingMigration && controlReady && failureMarkerReason) {
      try {
        await recordFailureMarker(client, pendingMigration, failureMarkerReason);
      } catch {
        failure = new MigrationApplyError(
          "MIGRATION_FAILURE_RECORDING_FAILED",
          migrationDetails(pendingMigration)
        );
        discardClient = true;
      }
    }
  } finally {
    if (client && advisoryLockHeld) {
      try {
        await client.query(RELEASE_ADVISORY_LOCK_SQL, [ADVISORY_LOCK_NAMESPACE]);
      } catch {
        discardClient = true;
        failure ??= new MigrationApplyError("ADVISORY_LOCK_RELEASE_FAILED");
      }
    }

    if (client) {
      try {
        client.release(
          discardClient ? new Error("migration advisory lock cleanup failed") : undefined
        );
      } catch {
        failure ??= new MigrationApplyError("MIGRATION_CLIENT_RELEASE_FAILED");
      }
    }
  }

  if (failure) {
    throw failure;
  }
}

export const migrationRunnerTestHooks = {
  acquireAdvisoryLockSql: ACQUIRE_ADVISORY_LOCK_SQL,
  clearFailureMarkerSql: CLEAR_FAILURE_MARKER_SQL,
  controlRegclassSql: CONTROL_REGCLASS_SQL,
  enableVectorSql: ENABLE_VECTOR_SQL,
  ensureControlTableSql: ENSURE_CONTROL_TABLE_SQL,
  ensureDrizzleSchemaSql: ENSURE_DRIZZLE_SCHEMA_SQL,
  publicTableCountSql: PUBLIC_TABLE_COUNT_SQL,
  readFailureMarkerSql: READ_FAILURE_MARKER_SQL,
  readLedgerSql: READ_LEDGER_SQL,
  releaseAdvisoryLockSql: RELEASE_ADVISORY_LOCK_SQL,
  upsertFailureMarkerSql: UPSERT_FAILURE_MARKER_SQL
};
