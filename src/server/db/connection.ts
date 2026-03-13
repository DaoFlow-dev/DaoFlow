import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow",
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

export const db = drizzle(pool);
export { pool };
