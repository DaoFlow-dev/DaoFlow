import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Backup and restore workflows", () => {
  test("backups page loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to backups page
    await page.getByRole("link", { name: "Backups" }).click();
    await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
  });

  test.skip("seed backup data is visible", async () => {
    // Pending: backup policy cards and run tables need data-testid attributes
  });

  test.skip("trigger a backup run from policy", async () => {
    // Pending: backup policy action buttons not yet on new BackupsPage
  });

  test.skip("queue a restore drill from a successful backup run", async () => {
    // Pending: restore workflow not yet on new BackupsPage
  });
});
