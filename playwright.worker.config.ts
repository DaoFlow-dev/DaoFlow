import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for worker E2E tests.
 *
 * Unlike the main config, this one:
 * - Does NOT set DISABLE_WORKER (so the worker starts)
 * - Sets TEMPORAL_ADDRESS so the Temporal worker connects
 * - Only runs workflow-specific spec files
 * - Uses a dedicated database to avoid conflicts with the main E2E suite
 */

const DB_URL =
  process.env.PLAYWRIGHT_WORKER_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e_worker";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "workflow-e2e.spec.ts",
  timeout: 120_000, // workflows take longer than UI tests
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "bun run db:rebuild && bun run db:seed:e2e-auth && bun run build && bun run start",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      DATABASE_URL: DB_URL,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "daoflow-e2e-worker-secret-2026",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "daoflow-e2e-encryption-key-32chars00",
      TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
      TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ?? "daoflow",
      TEMPORAL_TASK_QUEUE: "daoflow-deployments",
      DAOFLOW_ENABLE_TEMPORAL: "true",
      NODE_ENV: "production"
      // NOTE: DISABLE_WORKER is intentionally NOT set
    },
    url: "http://127.0.0.1:3000/trpc/health",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium-worker",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
