import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow",
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

// Prevent unhandled 'error' events on idle clients from crashing the process.
// Without this handler, a dropped connection in the pool kills the server.
pool.on("error", (err) => {
  console.error("[pg pool] Idle client error:", err.message);
});

import * as schema from "./schema";

export const db = drizzle(pool, { schema });
export { pool };
