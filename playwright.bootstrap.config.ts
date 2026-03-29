import { defineConfig, devices } from "@playwright/test";
import {
  createPlaywrightServerCommand,
  playwrightBaseUrl,
  playwrightHealthcheckUrl,
  playwrightServerPort
} from "./playwright.shared";

const PLAYWRIGHT_BOOTSTRAP_DATABASE_URL =
  process.env.PLAYWRIGHT_BOOTSTRAP_DATABASE_URL ??
  process.env.PLAYWRIGHT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://daoflow:daoflow_dev@localhost:5432/daoflow_e2e_bootstrap";
const SKIP_DB_BOOTSTRAP = process.env.PLAYWRIGHT_SKIP_DB_BOOTSTRAP === "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: playwrightBaseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: SKIP_DB_BOOTSTRAP
      ? createPlaywrightServerCommand()
      : createPlaywrightServerCommand("bun run db:reset", "bun run db:migrate"),
    env: {
      DATABASE_URL: PLAYWRIGHT_BOOTSTRAP_DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? "daoflow-e2e-secret-with-enough-entropy-2026",
      BETTER_AUTH_URL: playwrightBaseUrl,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "daoflow-e2e-encryption-key-32chars00",
      DISABLE_WORKER: "true",
      NODE_ENV: "production",
      PORT: playwrightServerPort
    },
    url: playwrightHealthcheckUrl,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /auth-bootstrap\.spec\.ts/
    }
  ]
});
