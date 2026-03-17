import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./packages/server/src/db/schema/control-plane.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow"
  }
});
