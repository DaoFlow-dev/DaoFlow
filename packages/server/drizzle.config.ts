import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow"
  },
  verbose: true,
  strict: false
});
