/**
 * json-helpers.ts
 *
 * Shared helpers for working with untyped JSONB values
 * from the database.  Every DB service file needs the same
 * handful of narrow-cast functions; keeping them here
 * avoids ~35 identical copies across the codebase.
 */

import { randomUUID } from "node:crypto";

/** Compact 32-hex-char ID derived from a UUID v4. */
export const newId = () => randomUUID().replace(/-/g, "").slice(0, 32);

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function readString(record: JsonRecord, key: string, fallback = "") {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

export function readNumber(record: JsonRecord, key: string, fallback: number | null = null) {
  const value = record[key];
  return typeof value === "number" ? value : fallback;
}

export function readBoolean(record: JsonRecord, key: string, fallback = false) {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

export function readStringArray(record: JsonRecord, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function readRecordArray(record: JsonRecord, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}
