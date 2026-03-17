import { expect, test } from "@playwright/test";
import { e2eAdminUser } from "../packages/server/src/testing/e2e-auth-users";
import { signInAsAdmin, signOut } from "./helpers";

test.describe("Authentication flows", () => {
  test("seeded admin sign-in loads the dashboard", async ({ page }) => {
    await signInAsAdmin(page);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.locator(".sidebar__user-name")).toContainText(e2eAdminUser.name);
  });

  test("unauthenticated user is redirected to login page", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sign up" })).toBeVisible();
  });

  test("sign-out redirects to login page", async ({ page }) => {
    await signInAsAdmin(page);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await signOut(page);
  });
});
