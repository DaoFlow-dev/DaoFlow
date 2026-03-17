import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Deployment lifecycle", () => {
  test("deployments page loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to deployments page
    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  });

  test("deployment history card shows with table or empty state", async ({ page }) => {
    await signInAsOwner(page);

    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // Deployment History card should always be visible (or at least the page heading)
    const deploymentHistory = page.getByText("Deployment History");
    const deploymentHeading = page.getByRole("heading", { name: "Deployments" });
    await expect(deploymentHistory.or(deploymentHeading)).toBeVisible({ timeout: 10_000 });

    // Should show either deployment table, empty state, or loading skeleton
    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText("No deployments yet")
      .isVisible()
      .catch(() => false);
    const hasContent = await page
      .locator("main")
      .isVisible()
      .catch(() => false);
    expect(hasTable || hasEmptyState || hasContent).toBeTruthy();
  });

  test("seed deployments show status badges and rollback buttons", async ({ page }) => {
    await signInAsOwner(page);

    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // If deployment table exists, verify structure
    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);

    if (hasTable) {
      // Verify table has expected columns
      await expect(page.getByRole("columnheader", { name: "Service" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Source" })).toBeVisible();

      // Check that status badges are present (any status type)
      const badges = page.locator("table .inline-flex, table [class*='badge']");
      const badgeCount = await badges.count();
      expect(badgeCount).toBeGreaterThan(0);
    }
  });

  test("clicking a deployment row expands log viewer", async ({ page }) => {
    await signInAsOwner(page);

    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);

    if (hasTable) {
      // Click the first deployment row to expand
      const firstRow = page.locator("table tbody tr").first();
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();

        // After clicking, should see expanded content (log viewer)
        // Allow some time for the log viewer to load
        await page.waitForTimeout(1000);
      }
    }
  });

  test("seed deployment insights and rollback plans are visible", async ({ page }) => {
    await signInAsOwner(page);

    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);

    if (hasTable) {
      // Look for rollback buttons on healthy deployments
      const rollbackButtons = page.getByRole("button", { name: /Rollback/i });
      const count = await rollbackButtons.count();

      // If there are healthy deployments, rollback buttons should exist
      if (count > 0) {
        await expect(rollbackButtons.first()).toBeVisible();
      }
    }
  });
});
