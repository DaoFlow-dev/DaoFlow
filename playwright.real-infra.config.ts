import { defineConfig, devices } from "@playwright/test";
import {
  createPlaywrightServerCommand,
  playwrightBaseUrl,
  playwrightHealthcheckUrl,
  playwrightServerPort
} from "./playwright.shared";

const databaseUrl = process.env.PLAYWRIGHT_REAL_INFRA_DATABASE_URL ?? "";
const localStateRoot = process.env.DAOFLOW_REAL_INFRA_LOCAL_STATE_ROOT ?? "";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /real-infra-.*\.spec\.ts/,
  globalSetup: "./e2e/fixtures/real-infra/global-setup.ts",
  globalTimeout: 570_000,
  timeout: 540_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: playwrightBaseUrl,
    trace: "off",
    video: "off",
    screenshot: "off"
  },
  webServer: {
    command: createPlaywrightServerCommand(),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
      BETTER_AUTH_URL: playwrightBaseUrl,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
      TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS ?? "",
      TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ?? "daoflow",
      TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE ?? "daoflow-deployments",
      DAOFLOW_ENABLE_TEMPORAL: "true",
      DAOFLOW_E2E: "true",
      DAOFLOW_SEED_DEMO: "1",
      REMOTE_GIT_WORK_DIR: process.env.DAOFLOW_REAL_INFRA_WORKSPACE_ROOT ?? "",
      SSH_CONTROL_DIR: `${localStateRoot}/ssh-control`,
      SSH_KEY_DIR: `${localStateRoot}/ssh-keys`,
      SSH_KNOWN_HOSTS_DIR: `${localStateRoot}/ssh-known-hosts`,
      NODE_ENV: "production",
      PORT: playwrightServerPort
    },
    url: playwrightHealthcheckUrl,
    reuseExistingServer: false,
    timeout: 300_000
  },
  projects: [
    {
      name: "chromium-real-infra",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
