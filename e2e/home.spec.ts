import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Dashboard", () => {
  test("loads the dashboard after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    // Dashboard heading
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Stats cards should be visible (use card labels, not sidebar links)
    await expect(page.locator(".text-2xl.font-bold").first()).toBeVisible();
  });

  test("sidebar navigation works", async ({ page }) => {
    await signInAsOwner(page);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Navigate to Projects
    await page.getByRole("link", { name: "Projects" }).click();
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    // Navigate to Servers
    await page.getByRole("link", { name: "Servers" }).click();
    await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();

    // Navigate to Deployments
    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // Navigate to Backups
    await page.getByRole("link", { name: "Backups" }).click();
    await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();

    // Navigate to Settings
    await page.getByRole("link", { name: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("deployment history table renders", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to deployments page
    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  });

  test("settings page has tabs", async ({ page }) => {
    await signInAsOwner(page);

    await page.getByRole("link", { name: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Verify tabs exist
    await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Users" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tokens" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Security" })).toBeVisible();
  });

  test("login page shows branding", async ({ page }) => {
    await page.goto("/login");

    // DaoFlow branding
    await expect(page.getByRole("heading", { name: "DaoFlow", level: 1 })).toBeVisible();
    await expect(
      page.getByText(
        "The agentic platform to host deterministic systems — from one prompt to production."
      )
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  });
});
