import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { resolveTestDatabaseUrl } from "./src/db/test-database-url";

const testDatabaseUrl = resolveTestDatabaseUrl();
process.env.TEST_DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";
mkdirSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "coverage/.tmp"), {
  recursive: true
});

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    // Server tests share one physical Postgres database today, so file-level
    // parallelism can corrupt suite state even when individual tests reset.
    fileParallelism: false,
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
