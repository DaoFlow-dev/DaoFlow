import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Deployment lifecycle", () => {
  test("deployments page loads with history table", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to deployments page
    await page.locator(".sidebar__link", { hasText: "Deployments" }).click();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    await expect(page.getByText("Deployment History")).toBeVisible();
  });

  test.skip("create deployment → dispatch → mark healthy", async () => {
    // Pending: deployment composer form not yet on new DeploymentsPage
  });

  test.skip("create deployment → dispatch → mark failed", async () => {
    // Pending: deployment lifecycle actions not yet on new DeploymentsPage
  });

  test.skip("seed deployment insights and rollback plans are visible", async () => {
    // Pending: insights and rollback UI not yet on new DeploymentsPage
  });
});
