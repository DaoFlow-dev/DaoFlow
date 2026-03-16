import { expect, test } from "@playwright/test";
import { signInAsOwner, OWNER_EMAIL } from "./helpers";

test.describe("Dashboard", () => {
  test("loads the dashboard after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    // Dashboard heading
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Stats cards should be visible
    await expect(page.getByText("Servers")).toBeVisible();
    await expect(page.getByText("Projects")).toBeVisible();
    await expect(page.getByText("Deployments")).toBeVisible();
  });

  test("sidebar navigation works", async ({ page }) => {
    await signInAsOwner(page);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Navigate to Projects
    await page.locator(".sidebar__link", { hasText: "Projects" }).click();
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    // Navigate to Servers
    await page.locator(".sidebar__link", { hasText: "Servers" }).click();
    await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();

    // Navigate to Deployments
    await page.locator(".sidebar__link", { hasText: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // Navigate to Backups
    await page.locator(".sidebar__link", { hasText: "Backups" }).click();
    await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();

    // Navigate to General Settings
    await page.locator(".sidebar__link", { hasText: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("deployment history table renders", async ({ page }) => {
    await signInAsOwner(page);

    // Recent Deployments card should be visible
    await expect(page.getByText("Recent Deployments")).toBeVisible();

    // The deployments page should show the table
    await page.locator(".sidebar__link", { hasText: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    await expect(page.getByText("Deployment History")).toBeVisible();
  });

  test("settings page has tabs", async ({ page }) => {
    await signInAsOwner(page);

    await page.locator(".sidebar__link", { hasText: "General" }).click();
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
    await expect(page.getByText("Deploy and manage Docker workloads")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  });
});
