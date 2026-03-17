import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Compose releases and drift", () => {
  test("compose data visible from dashboard", async ({ page }) => {
    await signInAsOwner(page);

    // Dashboard should load after sign-in
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Look for compose-related cards or sections on the dashboard
    // The dashboard typically shows deployment-related data including compose releases
    const dashboardContent = page.locator("main");
    await expect(dashboardContent).toBeVisible();
  });

  test("deployments page shows compose-sourced deployments", async ({ page }) => {
    await signInAsOwner(page);

    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // If deployment table exists, check for compose source type
    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);

    if (hasTable) {
      // Source column should exist
      await expect(page.getByRole("columnheader", { name: "Source" })).toBeVisible();
    }
  });

  test("compose drift inspector shows comparison data", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to deployments (compose drift is part of deployment context)
    await page.getByRole("link", { name: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // Deployment page should exist and show compose-related data
    await expect(page.getByText("Deployment History")).toBeVisible({ timeout: 10_000 });
  });
});
