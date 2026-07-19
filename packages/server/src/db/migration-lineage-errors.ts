export const MIGRATION_LINEAGE_MISMATCH = "MIGRATION_LINEAGE_MISMATCH" as const;

const MIGRATION_APPLY_REASONS = [
  "ADVISORY_LOCK_RELEASE_FAILED",
  "MIGRATION_FAILURE_RECORDING_FAILED",
  "MIGRATION_CLIENT_RELEASE_FAILED",
  "MIGRATION_OPERATION_FAILED",
  "MIGRATION_RECOVERY_REQUIRED",
  "PREVIOUS_MIGRATION_ATTEMPT_FAILED"
] as const;

const TAG_PATTERN = /^(\d+)_([a-z0-9][a-z0-9_-]*)$/i;
const SHORT_HASH_PATTERN = /^[a-f0-9]{12}$/i;
const SAFE_DETAIL_KEYS = new Set([
  "appliedCount",
  "appliedCreatedAt",
  "appliedHash",
  "appliedId",
  "expectedCreatedAt",
  "expectedHash",
  "expectedTag",
  "localCount",
  "markerCreatedAt",
  "markerHash",
  "position",
  "tableCount"
]);

export type MigrationLineageReason =
  | "DB_AHEAD"
  | "DB_DUPLICATE_ID"
  | "DB_DUPLICATE_TIMESTAMP"
  | "DB_ENTRY_OUT_OF_ORDER"
  | "DB_HASH_CHANGED"
  | "DB_INVALID_ENTRY"
  | "DB_MISSING_MIDDLE"
  | "DB_NOT_FULLY_MIGRATED"
  | "DB_UNKNOWN_ENTRY"
  | "LOCAL_DUPLICATE_INDEX"
  | "LOCAL_DUPLICATE_PREFIX"
  | "LOCAL_DUPLICATE_TAG"
  | "LOCAL_DUPLICATE_TIMESTAMP"
  | "LOCAL_INDEX_OUT_OF_ORDER"
  | "LOCAL_JOURNAL_INVALID"
  | "LOCAL_JOURNAL_MISSING"
  | "LOCAL_MIGRATION_FILE_MISSING"
  | "LOCAL_MIGRATIONS_MISSING"
  | "LOCAL_PREFIX_OUT_OF_ORDER"
  | "LOCAL_TAG_INVALID"
  | "LOCAL_TIMESTAMP_OUT_OF_ORDER"
  | "LOCAL_UNJOURNALED_SQL_FILE"
  | "SCHEMA_NOT_EMPTY";

export type MigrationLineageDetails = Readonly<Record<string, number | string | boolean>>;
export type MigrationApplyReason = (typeof MIGRATION_APPLY_REASONS)[number];

export class MigrationLineageError extends Error {
  readonly code = MIGRATION_LINEAGE_MISMATCH;

  constructor(
    readonly reason: MigrationLineageReason,
    readonly details: MigrationLineageDetails = {}
  ) {
    super(`Migration lineage mismatch: ${reason}.`);
    this.name = "MigrationLineageError";
  }
}

export class MigrationApplyError extends Error {
  readonly code = "MIGRATION_APPLY_FAILED" as const;

  constructor(
    readonly reason: MigrationApplyReason,
    readonly details: MigrationLineageDetails = {}
  ) {
    super(`Migration application failed: ${reason}.`);
    this.name = "MigrationApplyError";
  }
}

const MIGRATION_LINEAGE_REASON_SET = new Set<MigrationLineageReason>([
  "DB_AHEAD",
  "DB_DUPLICATE_ID",
  "DB_DUPLICATE_TIMESTAMP",
  "DB_ENTRY_OUT_OF_ORDER",
  "DB_HASH_CHANGED",
  "DB_INVALID_ENTRY",
  "DB_MISSING_MIDDLE",
  "DB_NOT_FULLY_MIGRATED",
  "DB_UNKNOWN_ENTRY",
  "LOCAL_DUPLICATE_INDEX",
  "LOCAL_DUPLICATE_PREFIX",
  "LOCAL_DUPLICATE_TAG",
  "LOCAL_DUPLICATE_TIMESTAMP",
  "LOCAL_INDEX_OUT_OF_ORDER",
  "LOCAL_JOURNAL_INVALID",
  "LOCAL_JOURNAL_MISSING",
  "LOCAL_MIGRATION_FILE_MISSING",
  "LOCAL_MIGRATIONS_MISSING",
  "LOCAL_PREFIX_OUT_OF_ORDER",
  "LOCAL_TAG_INVALID",
  "LOCAL_TIMESTAMP_OUT_OF_ORDER",
  "LOCAL_UNJOURNALED_SQL_FILE",
  "SCHEMA_NOT_EMPTY"
]);
const MIGRATION_APPLY_REASON_SET = new Set<MigrationApplyReason>(MIGRATION_APPLY_REASONS);
const NON_BYPASSABLE_MIGRATION_REASONS = new Set<MigrationApplyReason>([
  "MIGRATION_FAILURE_RECORDING_FAILED",
  "MIGRATION_RECOVERY_REQUIRED",
  "PREVIOUS_MIGRATION_ATTEMPT_FAILED"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMigrationLineageError(error: unknown): error is MigrationLineageError {
  return (
    error instanceof MigrationLineageError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === MIGRATION_LINEAGE_MISMATCH)
  );
}

export function isMigrationApplyError(error: unknown): error is MigrationApplyError {
  return (
    error instanceof MigrationApplyError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "MIGRATION_APPLY_FAILED")
  );
}

export function isNonBypassableMigrationFailure(error: unknown) {
  if (isMigrationLineageError(error)) return true;
  if (!isMigrationApplyError(error)) return false;
  return NON_BYPASSABLE_MIGRATION_REASONS.has(
    (error as { reason?: unknown }).reason as MigrationApplyReason
  );
}

function formatSafeMigrationDetails(details: unknown) {
  if (!isRecord(details)) {
    return "";
  }

  const values = Object.entries(details)
    .filter(([key, value]) => {
      if (!SAFE_DETAIL_KEYS.has(key)) {
        return false;
      }
      if (typeof value === "number") {
        return Number.isSafeInteger(value);
      }
      if (typeof value !== "string") {
        return false;
      }
      if (key === "expectedTag") {
        return TAG_PATTERN.test(value);
      }
      if (key.endsWith("Hash")) {
        return SHORT_HASH_PATTERN.test(value);
      }
      return false;
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`);

  return values.length > 0 ? ` (${values.join(", ")})` : "";
}

export function describeMigrationFailure(error: unknown) {
  if (
    isMigrationLineageError(error) &&
    MIGRATION_LINEAGE_REASON_SET.has(
      (error as { reason?: unknown }).reason as MigrationLineageReason
    )
  ) {
    return `${error.code}: ${error.reason}${formatSafeMigrationDetails(error.details)}`;
  }
  if (
    isMigrationApplyError(error) &&
    MIGRATION_APPLY_REASON_SET.has((error as { reason?: unknown }).reason as MigrationApplyReason)
  ) {
    return `${error.code}: ${error.reason}${formatSafeMigrationDetails(error.details)}`;
  }

  return "MIGRATION_APPLY_FAILED: MIGRATION_OPERATION_FAILED";
}
