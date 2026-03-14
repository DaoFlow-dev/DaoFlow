import { expect, test } from "@playwright/test";
import { signUpOwner, signInAsOwner, OWNER_EMAIL, OWNER_PASSWORD } from "./helpers";

test.describe("Authentication flows", () => {
  test("first user sign-up → owner role → sign-out → sign-in cycle", async ({ page }) => {
    await page.goto("/");

    // Confirm landing page loads
    await expect(page.getByRole("heading", { name: "DaoFlow", level: 1 })).toBeVisible();
    await expect(page.getByTestId("session-state")).toHaveText("signed out");

    // Sign up as the first user (gets owner role) using shared credentials
    await signUpOwner(page);

    // Verify session established
    await expect(page.getByTestId("session-state")).toHaveText("signed in");
    await expect(page.getByTestId("session-email")).toHaveText(OWNER_EMAIL);
    await expect(page.getByTestId("role-state")).toHaveText("owner");
    await expect(page.getByTestId("auth-role")).toContainText("owner");

    // Verify protected data loads
    await expect(page.getByTestId("viewer-output")).toContainText(OWNER_EMAIL);
    await expect(page.getByTestId("admin-output")).toContainText('"defaultSignupRole"');

    // Sign out
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("session-state")).toHaveText("signed out");

    // Switch to sign-in tab and sign back in
    await page.getByRole("button", { name: "Sign in" }).first().click();
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).last().click();

    // Verify re-authenticated
    await expect(page.getByTestId("session-state")).toHaveText("signed in");
    await expect(page.getByTestId("session-email")).toHaveText(OWNER_EMAIL);
    await expect(page.getByTestId("role-state")).toHaveText("owner");
  });

  test("second user registration gets viewer role", async ({ page }) => {
    await page.goto("/");

    // Register a brand-new second user (should get viewer, since owner exists)
    const viewer = `viewer+${Date.now()}@daoflow.local`;
    await page.getByLabel("Name").fill("Viewer User");
    await page.getByLabel("Email").fill(viewer);
    await page.getByLabel("Password").fill("viewerpass123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByTestId("session-state")).toHaveText("signed in");
    await expect(page.getByTestId("session-email")).toHaveText(viewer);
    await expect(page.getByTestId("role-state")).toHaveText("viewer");
  });

  test("protected panels require authentication", async ({ page }) => {
    await page.goto("/");

    // Before sign-in, viewer panel shows placeholder
    await expect(page.getByText("Sign in to fetch the protected viewer procedure.")).toBeVisible();

    // Hero metrics show guest role
    await expect(page.getByTestId("role-state")).toHaveText("guest");
  });
});
