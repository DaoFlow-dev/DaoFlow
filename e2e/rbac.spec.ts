import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("RBAC and agent tokens", () => {
  test("settings page loads with tabs", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to settings
    await page.locator(".sidebar__link", { hasText: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Verify key tabs exist
    await expect(page.getByRole("tab", { name: "Tokens" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Security" })).toBeVisible();
  });

  test.skip("owner can see agent token inventory", async () => {
    // Pending: token inventory not yet on new settings tabs
  });

  test.skip("owner sees full audit trail", async () => {
    // Pending: audit trail not yet on new settings tabs
  });

  test.skip("owner sees deployment logs", async () => {
    // Pending: deployment logs panel not yet built
  });

  test.skip("owner sees persistent volume registry", async () => {
    // Pending: volume registry not yet on new pages
  });

  test.skip("Better Auth + tRPC protected procedure heading visible after auth", async () => {
    // Pending: auth debug panel removed in new UI
  });
});
