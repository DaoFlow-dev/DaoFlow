import { expect, type Page } from "@playwright/test";

/**
 * Shared owner credentials used across all E2E test files.
 * The first call to signUpOwner() creates this user (gets "owner" role).
 * All subsequent tests call signInAsOwner() to reuse them.
 */
export const OWNER_EMAIL = "e2e-owner@daoflow.local";
export const OWNER_PASSWORD = "owner-e2e-pass-2026";
export const OWNER_NAME = "E2E Owner";

/** Auth operations can be slow in CI — use a generous timeout. */
const AUTH_TIMEOUT = 30_000;

/** Sign up the shared owner account. Call this ONCE (in global-setup). */
export async function signUpOwner(page: Page) {
  await page.goto("/");
  await page.getByLabel("Name").fill(OWNER_NAME);
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("signed in", {
    timeout: AUTH_TIMEOUT
  });
}

/** Sign in as the shared owner. Call this in every other test file. */
export async function signInAsOwner(page: Page) {
  await page.goto("/");
  // The default mode is "sign-up". Click the "Sign in" tab to switch.
  await page.locator(".auth-panel__switches button", { hasText: "Sign in" }).click();
  // Wait for the form to switch to sign-in mode (Name field disappears)
  await expect(page.getByLabel("Name")).not.toBeVisible();
  // Fill credentials
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  // Click the submit button
  await page.locator(".auth-form .action-button").click();
  await expect(page.getByTestId("session-state")).toHaveText("signed in", {
    timeout: AUTH_TIMEOUT
  });
}
