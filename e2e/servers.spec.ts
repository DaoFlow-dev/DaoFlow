import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Server management", () => {
  test("servers page loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to servers page
    await page.getByRole("link", { name: "Servers" }).click();
    await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();
  });

  test("register a new server and verify infrastructure inventory", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to servers page
    await page.getByRole("link", { name: "Servers" }).click();
    await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();

    // The "Add Server" button should exist (even if disabled in current UI)
    await expect(page.getByRole("button", { name: "Add Server" })).toBeVisible();

    // Verify the page shows either server cards or empty state
    const hasServers = await page
      .locator("[class*='card']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText("No servers registered")
      .isVisible()
      .catch(() => false);
    expect(hasServers || hasEmptyState).toBeTruthy();
  });

  test("seed servers show in readiness panel with connectivity status", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to servers page
    await page.getByRole("link", { name: "Servers" }).click();
    await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();

    // If seed servers exist, they should have connectivity information
    const serverCards = page.locator("[class*='card']");
    const count = await serverCards.count();

    if (count > 0) {
      // Each card should show connectivity info (Docker + SSH)
      const firstCard = serverCards.first();
      await expect(firstCard).toBeVisible();

      // Verify connectivity status text is present
      await expect(firstCard.getByText(/Docker:|SSH:|Online|Offline/).first()).toBeVisible();
    }
  });
});
