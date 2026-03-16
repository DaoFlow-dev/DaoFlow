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
  await page.goto("/login");
  // Default tab is "Sign in" — switch to "Sign up"
  await page.getByRole("tab", { name: "Sign up" }).click();
  await page.getByLabel("Name").fill(OWNER_NAME);
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Wait for either redirect to dashboard or an error
  const dashboardVisible = page
    .getByRole("heading", { name: "Dashboard" })
    .or(page.locator(".sidebar__title"));
  const alreadyExists = page.getByText("User already exists");

  const result = await Promise.race([
    dashboardVisible
      .first()
      .waitFor({ timeout: AUTH_TIMEOUT })
      .then(() => "signed-in" as const),
    alreadyExists.waitFor({ timeout: AUTH_TIMEOUT }).then(() => "exists" as const)
  ]);

  if (result === "exists") {
    // User already created from a previous run — switch to sign-in
    await page.getByRole("tab", { name: "Sign in" }).click();
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(dashboardVisible.first()).toBeVisible({ timeout: AUTH_TIMEOUT });
  }
  // If result === "signed-in", we're already on the dashboard
}

/** Sign in as the shared owner. Call this in every other test file. */
export async function signInAsOwner(page: Page) {
  await page.goto("/login");
  // Default tab is "Sign in" — fill credentials directly
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Wait for redirect to dashboard
  await expect(
    page.getByRole("heading", { name: "Dashboard" }).or(page.locator(".sidebar__title")).first()
  ).toBeVisible({ timeout: AUTH_TIMEOUT });
}
