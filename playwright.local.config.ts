/**
 * Playwright config for running E2E tests against the local docker-compose dev
 * environment. This assumes `docker compose up -d` is already running with
 * all services (postgres, redis, temporal, etc).
 *
 * Usage:
 *   docker compose up -d
 *   bun run dev &
 *   bunx playwright test --config playwright.local.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "bun run dev",
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? "daoflow-local-e2e-secret-with-enough-entropy-2026",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "daoflow-local-e2e-encrypt-key-32ch",
      NODE_ENV: "development"
    },
    port: 3000,
    reuseExistingServer: true,
    timeout: 30_000
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
