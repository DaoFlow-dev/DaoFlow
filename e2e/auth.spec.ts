import { expect, test } from "@playwright/test";
import { e2eAdminUser } from "../packages/server/src/testing/e2e-auth-users";
import {
  createPasswordResetToken,
  getCurrentSession,
  signInAsAdmin,
  signInWithEmailPassword,
  signOut,
  signUpWithEmailPassword
} from "./helpers";

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

  test("expired session redirects back to login with a returnTo path", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/deployments");

    await expect(page).toHaveURL(/\/login\?returnTo=%2Fdeployments/);
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await page.getByLabel("Email").fill(e2eAdminUser.email);
    await page.getByLabel("Password").fill(e2eAdminUser.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/deployments$/);
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  });

  test("password reset accepts a valid token and allows sign-in with the new password", async ({
    page
  }) => {
    const email = `reset-user+${Date.now()}@daoflow.local`;
    const oldPassword = "reset-old-pass-2026";
    const newPassword = "reset-new-pass-2026";

    await signUpWithEmailPassword(page, {
      name: "Reset Password User",
      email,
      password: oldPassword
    });

    const session = await getCurrentSession(page);
    const token = await createPasswordResetToken(session.user.id);

    await signOut(page);
    await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
    await page.getByTestId("reset-password-new").fill(newPassword);
    await page.getByTestId("reset-password-confirm").fill(newPassword);
    await page.getByTestId("reset-password-submit").click();

    await expect(page.getByTestId("reset-password-success")).toBeVisible();

    await signInWithEmailPassword(page, { email, password: newPassword });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
