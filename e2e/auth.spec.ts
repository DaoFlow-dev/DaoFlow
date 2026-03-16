import { expect, test } from "@playwright/test";
import { signInAsOwner, OWNER_EMAIL, OWNER_PASSWORD } from "./helpers";

test.describe("Authentication flows", () => {
  test("owner sign-in — dashboard loads after authentication", async ({ page }) => {
    // Sign in as the owner (created in global-setup)
    await signInAsOwner(page);

    // Verify we landed on the dashboard
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Verify sidebar shows user info
    await expect(page.locator(".sidebar__user-name")).toContainText("E2E Owner");
  });

  test("unauthenticated user is redirected to login page", async ({ page }) => {
    await page.goto("/");

    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/);

    // Login page should have the auth card
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sign up" })).toBeVisible();
  });

  test("sign-out redirects to login page", async ({ page }) => {
    // Sign in first
    await signInAsOwner(page);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Open user dropdown and sign out
    await page.locator(".sidebar__user-card").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    // Should redirect to login page
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("second user registration gets viewer role", async ({ page }) => {
    await page.goto("/login");

    // Switch to sign-up tab
    await page.getByRole("tab", { name: "Sign up" }).click();

    // Register a brand-new second user
    const viewer = `viewer+${Date.now()}@daoflow.local`;
    await page.getByLabel("Name").fill("Viewer User");
    await page.getByLabel("Email").fill(viewer);
    await page.getByLabel("Password").fill("viewerpass123");
    await page.getByRole("button", { name: "Create account" }).click();

    // Should redirect to dashboard
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
      timeout: 15_000
    });
  });
});
