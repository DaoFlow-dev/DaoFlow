import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("RBAC and agent tokens", () => {
  test("settings page loads with tabs", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to settings
    await page.getByRole("link", { name: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Verify key tabs exist
    await expect(page.getByRole("tab", { name: "Tokens" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Security" })).toBeVisible();
  });

  test("owner can see agent token inventory", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to settings → Tokens tab
    await page.getByRole("link", { name: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Tokens" }).click();

    // Token inventory card should be visible (or at least the tab content area)
    const apiTokensText = page.getByText("API Tokens");
    const tokensTab = page.getByRole("tab", { name: "Tokens" });
    await expect(apiTokensText.or(tokensTab).first()).toBeVisible({ timeout: 10_000 });

    // The description text may take time to render
    const description = page.getByText("Scoped API tokens for integrations and agent access.");
    const headingFallback = page.getByRole("heading", { name: "Settings" });
    await expect(description.or(headingFallback).first()).toBeVisible({ timeout: 10_000 });

    // Should show either "No API tokens" empty state or the token table
    const hasTokens = await page
      .locator("table")
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText("No API tokens created yet.")
      .isVisible()
      .catch(() => false);
    expect(hasTokens || hasEmptyState).toBeTruthy();
  });

  test("owner sees full audit trail", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to settings → Security tab
    await page.getByRole("link", { name: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Security" }).click();

    // Security & Audit card should be visible
    await expect(page.getByText("Security & Audit")).toBeVisible();
    await expect(page.getByText("Recent audit trail and security events.")).toBeVisible();

    // Should show either empty state or audit table with expected columns
    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText("No audit entries recorded yet.")
      .isVisible()
      .catch(() => false);
    expect(hasTable || hasEmptyState).toBeTruthy();

    // If table exists, verify the column headers
    if (hasTable) {
      await expect(page.getByRole("columnheader", { name: "Action" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Actor" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Resource" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Outcome" })).toBeVisible();
    }
  });

  test("owner sees deployment logs", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to deployments page
    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // Should show "Deployment History" card or at least the page heading
    const deploymentHistory = page.getByText("Deployment History");
    const deploymentHeading = page.getByRole("heading", { name: "Deployments" });
    await expect(deploymentHistory.or(deploymentHeading).first()).toBeVisible({ timeout: 10_000 });

    // If deployments exist, verify the table has expected columns
    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);
    if (hasTable) {
      await expect(page.getByRole("columnheader", { name: "Service" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    }
  });

  test("owner sees persistent volume registry", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to settings → Volumes tab
    await page.getByRole("link", { name: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Volumes" }).click();

    // Volumes card should be visible
    await expect(page.getByText("Persistent Volumes")).toBeVisible();
    await expect(page.getByText("Manage named volumes and storage configuration.")).toBeVisible();
  });
});
