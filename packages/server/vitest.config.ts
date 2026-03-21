import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function resolveTestDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const baseUrl = new URL(
    process.env.DATABASE_URL ?? "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow"
  );
  const databaseName = baseUrl.pathname.replace(/^\//, "") || "daoflow";

  if (!databaseName.endsWith("_test")) {
    baseUrl.pathname = `/${databaseName}_test`;
  }

  return baseUrl.toString();
}

process.env.DATABASE_URL = resolveTestDatabaseUrl();
mkdirSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "coverage/.tmp"), {
  recursive: true
});

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    maxWorkers: 1,
    minWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"]
    }
  }
});
