import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

function resolveConnectionString() {
  return process.env.DATABASE_URL ?? "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow";
}

function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });

  // Prevent unhandled 'error' events on idle clients from crashing the process.
  // Without this handler, a dropped connection in the pool kills the server.
  pool.on("error", (err) => {
    console.error("[pg pool] Idle client error:", err.message);
  });

  return pool;
}

let currentConnectionString = resolveConnectionString();
let currentPool = createPool(currentConnectionString);

export const pool = new Proxy({} as pg.Pool, {
  get(_target, property) {
    const member = currentPool[property as keyof pg.Pool];
    if (typeof member !== "function") {
      return member;
    }

    const method = member as (this: pg.Pool, ...args: unknown[]) => unknown;
    return (...args: unknown[]) => method.apply(currentPool, args);
  }
});

export const db = drizzle(pool, { schema });

export function getDatabaseConnectionString() {
  return currentConnectionString;
}

export async function reconfigureDatabasePool(connectionString = resolveConnectionString()) {
  const nextPool = createPool(connectionString);
  const previousPool = currentPool;
  currentPool = nextPool;
  currentConnectionString = connectionString;
  await previousPool.end().catch(() => undefined);
}
