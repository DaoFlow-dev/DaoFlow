import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MigrationLineageError, type MigrationLineageDetails } from "./migration-lineage-errors";

export {
  MIGRATION_LINEAGE_MISMATCH,
  MigrationApplyError,
  MigrationLineageError,
  describeMigrationFailure,
  isMigrationApplyError,
  isMigrationLineageError,
  isNonBypassableMigrationFailure
} from "./migration-lineage-errors";
export type {
  MigrationApplyReason,
  MigrationLineageDetails,
  MigrationLineageReason
} from "./migration-lineage-errors";

export type LocalMigration = {
  index: number;
  tag: string;
  createdAt: number;
  hash: string;
};

export type AppliedMigration = {
  id: number;
  hash: string;
  createdAt: number;
};

type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
};

type UnknownRecord = Record<string, unknown>;

const TAG_PATTERN = /^(\d+)_([a-z0-9][a-z0-9_-]*)$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function shortHash(hash: string) {
  return hash.slice(0, 12);
}

function expectedMigrationDetails(migration: LocalMigration | undefined): MigrationLineageDetails {
  if (!migration) {
    return {};
  }

  return {
    expectedTag: migration.tag,
    expectedCreatedAt: migration.createdAt,
    expectedHash: shortHash(migration.hash)
  };
}

function appliedMigrationDetails(migration: AppliedMigration | undefined): MigrationLineageDetails {
  if (!migration) {
    return {};
  }

  return {
    appliedId: migration.id,
    appliedCreatedAt: migration.createdAt,
    appliedHash: shortHash(migration.hash)
  };
}

function toSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }

  if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readJournalEntries(migrationsFolder: string): JournalEntry[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new MigrationLineageError("LOCAL_JOURNAL_MISSING");
  }

  let journal: unknown;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    throw new MigrationLineageError("LOCAL_JOURNAL_INVALID");
  }

  if (!isRecord(journal) || !Array.isArray(journal.entries)) {
    throw new MigrationLineageError("LOCAL_JOURNAL_INVALID");
  }

  return journal.entries.map((entry, position) => {
    if (!isRecord(entry)) {
      throw new MigrationLineageError("LOCAL_JOURNAL_INVALID", { position });
    }

    const index = toSafeInteger(entry.idx);
    const timestamp = toSafeInteger(entry.when);
    if (index === null || timestamp === null || typeof entry.tag !== "string") {
      throw new MigrationLineageError("LOCAL_JOURNAL_INVALID", { position });
    }

    return { idx: index, tag: entry.tag, when: timestamp };
  });
}

function validateLocalEntry(
  entry: JournalEntry,
  position: number,
  seenIndexes: Set<number>,
  seenTags: Set<string>,
  seenPrefixes: Set<number>,
  seenTimestamps: Set<number>,
  previousTimestamp: number | undefined
) {
  if (seenIndexes.has(entry.idx)) {
    throw new MigrationLineageError("LOCAL_DUPLICATE_INDEX", { position });
  }
  if (entry.idx !== position) {
    throw new MigrationLineageError("LOCAL_INDEX_OUT_OF_ORDER", { position });
  }

  const tagMatch = TAG_PATTERN.exec(entry.tag);
  if (!tagMatch) {
    throw new MigrationLineageError("LOCAL_TAG_INVALID", { position });
  }

  const numericPrefix = Number(tagMatch[1]);
  if (!Number.isSafeInteger(numericPrefix) || numericPrefix !== entry.idx) {
    throw new MigrationLineageError("LOCAL_PREFIX_OUT_OF_ORDER", { position });
  }
  if (seenTags.has(entry.tag)) {
    throw new MigrationLineageError("LOCAL_DUPLICATE_TAG", { position });
  }
  if (seenPrefixes.has(numericPrefix)) {
    throw new MigrationLineageError("LOCAL_DUPLICATE_PREFIX", { position });
  }
  if (seenTimestamps.has(entry.when)) {
    throw new MigrationLineageError("LOCAL_DUPLICATE_TIMESTAMP", { position });
  }
  if (entry.when <= 0 || (previousTimestamp !== undefined && entry.when <= previousTimestamp)) {
    throw new MigrationLineageError("LOCAL_TIMESTAMP_OUT_OF_ORDER", { position });
  }

  seenIndexes.add(entry.idx);
  seenTags.add(entry.tag);
  seenPrefixes.add(numericPrefix);
  seenTimestamps.add(entry.when);
}

export function readLocalMigrationLineage(migrationsFolder: string): LocalMigration[] {
  if (!existsSync(migrationsFolder)) {
    throw new MigrationLineageError("LOCAL_MIGRATIONS_MISSING");
  }

  const entries = readJournalEntries(migrationsFolder);
  const seenIndexes = new Set<number>();
  const seenTags = new Set<string>();
  const seenPrefixes = new Set<number>();
  const seenTimestamps = new Set<number>();
  const localMigrations: LocalMigration[] = [];
  let previousTimestamp: number | undefined;

  for (const [position, entry] of entries.entries()) {
    validateLocalEntry(
      entry,
      position,
      seenIndexes,
      seenTags,
      seenPrefixes,
      seenTimestamps,
      previousTimestamp
    );

    const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    let source: string;
    try {
      source = readFileSync(migrationPath, "utf8");
    } catch {
      throw new MigrationLineageError("LOCAL_MIGRATION_FILE_MISSING", { position });
    }

    localMigrations.push({
      index: entry.idx,
      tag: entry.tag,
      createdAt: entry.when,
      hash: createHash("sha256").update(source).digest("hex")
    });
    previousTimestamp = entry.when;
  }

  const expectedFiles = new Set(localMigrations.map((migration) => `${migration.tag}.sql`));
  const unjournaledSqlFiles = readdirSync(migrationsFolder, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".sql") && !expectedFiles.has(entry.name)
  );
  if (unjournaledSqlFiles.length > 0) {
    throw new MigrationLineageError("LOCAL_UNJOURNALED_SQL_FILE", {
      count: unjournaledSqlFiles.length
    });
  }

  return localMigrations;
}

export function normalizeAppliedMigrationRows(rows: readonly UnknownRecord[]): AppliedMigration[] {
  const seenIds = new Set<number>();
  const seenTimestamps = new Set<number>();
  let previousTimestamp: number | undefined;

  return rows.map((row, position) => {
    const id = toSafeInteger(row.id);
    const createdAt = toSafeInteger(row.created_at);
    const hash = row.hash;
    if (
      id === null ||
      id <= 0 ||
      createdAt === null ||
      createdAt <= 0 ||
      typeof hash !== "string"
    ) {
      throw new MigrationLineageError("DB_INVALID_ENTRY", { position });
    }
    if (!HASH_PATTERN.test(hash)) {
      throw new MigrationLineageError("DB_INVALID_ENTRY", {
        position,
        appliedId: id,
        appliedCreatedAt: createdAt
      });
    }
    const details = { position, ...appliedMigrationDetails({ id, createdAt, hash }) };
    if (seenIds.has(id)) {
      throw new MigrationLineageError("DB_DUPLICATE_ID", details);
    }
    if (seenTimestamps.has(createdAt)) {
      throw new MigrationLineageError("DB_DUPLICATE_TIMESTAMP", details);
    }
    if (previousTimestamp !== undefined && createdAt <= previousTimestamp) {
      throw new MigrationLineageError("DB_ENTRY_OUT_OF_ORDER", details);
    }

    seenIds.add(id);
    seenTimestamps.add(createdAt);
    previousTimestamp = createdAt;
    return { id, hash, createdAt };
  });
}

export function assertAppliedLineageIsPrefix(
  localMigrations: readonly LocalMigration[],
  appliedMigrations: readonly AppliedMigration[]
) {
  if (appliedMigrations.length > localMigrations.length) {
    const firstAheadMigration = appliedMigrations[localMigrations.length];
    throw new MigrationLineageError("DB_AHEAD", {
      appliedCount: appliedMigrations.length,
      localCount: localMigrations.length,
      ...appliedMigrationDetails(firstAheadMigration)
    });
  }

  for (const [position, applied] of appliedMigrations.entries()) {
    const expected = localMigrations[position];
    if (!expected) {
      throw new MigrationLineageError("DB_AHEAD", {
        position,
        ...appliedMigrationDetails(applied)
      });
    }
    const details = {
      position,
      ...expectedMigrationDetails(expected),
      ...appliedMigrationDetails(applied)
    };
    if (applied.createdAt === expected.createdAt && applied.hash !== expected.hash) {
      throw new MigrationLineageError("DB_HASH_CHANGED", details);
    }
    if (applied.createdAt === expected.createdAt) {
      continue;
    }

    const localPosition = localMigrations.findIndex(
      (migration) => migration.createdAt === applied.createdAt
    );
    if (localPosition === -1 && applied.createdAt > (localMigrations.at(-1)?.createdAt ?? 0)) {
      throw new MigrationLineageError("DB_AHEAD", details);
    }
    if (localPosition > position) {
      throw new MigrationLineageError("DB_MISSING_MIDDLE", details);
    }
    if (localPosition >= 0 && localPosition < position) {
      throw new MigrationLineageError("DB_ENTRY_OUT_OF_ORDER", details);
    }
    throw new MigrationLineageError("DB_UNKNOWN_ENTRY", details);
  }
}

export function assertAppliedLineageIsComplete(
  localMigrations: readonly LocalMigration[],
  appliedMigrations: readonly AppliedMigration[]
) {
  assertAppliedLineageIsPrefix(localMigrations, appliedMigrations);
  if (appliedMigrations.length !== localMigrations.length) {
    throw new MigrationLineageError("DB_NOT_FULLY_MIGRATED", {
      appliedCount: appliedMigrations.length,
      localCount: localMigrations.length,
      ...expectedMigrationDetails(localMigrations[appliedMigrations.length]),
      ...appliedMigrationDetails(appliedMigrations.at(-1))
    });
  }
}
