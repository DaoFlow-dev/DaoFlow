import pg from "pg";
import { resolveTestDatabaseUrl } from "./db/test-database-url";

const { Client } = pg;
const FNV_64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const UNSIGNED_32_BIT_MASK = 0xffffffffn;
const SIGNED_32_BIT_MAX = 0x7fffffffn;
const SIGNED_32_BIT_MODULUS = 0x100000000n;

function toSigned32Bit(value: bigint) {
  return Number(value > SIGNED_32_BIT_MAX ? value - SIGNED_32_BIT_MODULUS : value);
}

function hashDatabaseName(databaseName: string) {
  let hash = FNV_64_OFFSET_BASIS;

  for (const byte of new TextEncoder().encode(databaseName)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_64_PRIME) & ((1n << 64n) - 1n);
  }

  return hash;
}

export function deriveTestRunLock(testDatabaseUrl: string) {
  const targetUrl = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(targetUrl.pathname.replace(/^\/+/, ""));

  if (!databaseName) {
    throw new Error("Test database URL must include a database name.");
  }

  const maintenanceUrl = new URL(targetUrl);
  maintenanceUrl.pathname = "/postgres";

  const hash = hashDatabaseName(databaseName);
  const advisoryLockKeys = [
    toSigned32Bit((hash >> 32n) & UNSIGNED_32_BIT_MASK),
    toSigned32Bit(hash & UNSIGNED_32_BIT_MASK)
  ];

  return {
    maintenanceDatabaseUrl: maintenanceUrl.toString(),
    advisoryLockKeys
  };
}

export default async function setupServerTestRunLock() {
  const lock = deriveTestRunLock(resolveTestDatabaseUrl());
  const client = new Client({ connectionString: lock.maintenanceDatabaseUrl });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1::integer, $2::integer)", lock.advisoryLockKeys);
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }

  return async () => {
    try {
      await client.query(
        "SELECT pg_advisory_unlock($1::integer, $2::integer)",
        lock.advisoryLockKeys
      );
    } finally {
      await client.end();
    }
  };
}
