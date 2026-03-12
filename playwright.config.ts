import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "pnpm build && pnpm start",
    env: {
      BETTER_AUTH_SECRET: "daoflow-e2e-secret-with-enough-entropy-2026",
      BETTER_AUTH_URL: "http://127.0.0.1:3000"
    },
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
