import { defineConfig, devices } from "@playwright/test";

const PLAYWRIGHT_DATABASE_URL =
  process.env.PLAYWRIGHT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command:
      "bun packages/server/src/db/reset.ts && bun run db:push:ci && bun run build && bun run start",
    env: {
      DATABASE_URL: PLAYWRIGHT_DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? "daoflow-e2e-secret-with-enough-entropy-2026",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "daoflow-e2e-encryption-key-32chars00",
      DISABLE_WORKER: "true",
      NODE_ENV: "production"
    },
    port: 3000,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.spec\.ts/
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/global-setup\.spec\.ts/, /docs\.spec\.ts/],
      dependencies: ["setup"]
    }
  ]
});
