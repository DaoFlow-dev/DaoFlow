import { test } from "@playwright/test";

test.describe("Environment variables", () => {
  test.skip("seed environment variables are visible", async () => {
    // Pending: env var UI not yet on new settings/pages
  });

  test.skip("save a runtime environment variable", async () => {
    // Pending: env var form not yet on new pages
  });

  test.skip("save a secret environment variable shows masked value", async () => {
    // Pending: env var form not yet on new pages
  });

  test.skip("save a build variable with branch pattern", async () => {
    // Pending: env var form not yet on new pages
  });
});
