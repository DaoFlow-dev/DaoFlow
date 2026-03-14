import { test as setup } from "@playwright/test";
import { signUpOwner } from "./helpers";

/**
 * Global setup: create the shared owner user before any test file runs.
 * This runs as a Playwright "setup" project dependency.
 */
setup("create owner user", async ({ page }) => {
  await signUpOwner(page);
});
