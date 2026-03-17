/**
 * Playwright config for running E2E tests against the local docker-compose dev
 * environment. This assumes `docker compose up -d` is already running with
 * all services (postgres, redis, temporal, etc).
 *
 * Usage:
 *   docker compose up -d
 *   bun run db:rebuild
 *   bun run db:seed:e2e-auth
 *   bun run dev &
 *   bunx playwright test --config playwright.local.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/auth-bootstrap\.spec\.ts/, /docs\.spec\.ts/]
    }
  ]
});
