import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for docs site E2E tests.
 *
 * Serves the Docusaurus static build and runs tests against it.
 * Usage: bunx playwright test --config playwright-docs.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "docs.spec.ts",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:4000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "cd docs && bun run build && bun run serve -- --port 4000",
    port: 4000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "docs",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
