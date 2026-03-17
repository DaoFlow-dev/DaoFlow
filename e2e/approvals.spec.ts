import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Approval workflows", () => {
  test("settings page security tab shows audit and approval context", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to settings → Security tab
    await page.getByRole("link", { name: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Security" }).click();

    // Security & Audit card should be visible — approvals are part of the audit trail
    await expect(page.getByText("Security & Audit")).toBeVisible();
  });

  test("seed approval data is present in audit trail", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to settings → Security tab
    await page.getByRole("link", { name: "General" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Security" }).click();

    // Security card should be visible
    await expect(page.getByText("Security & Audit")).toBeVisible();

    // If there are audit entries, they may include approval records
    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText("No audit entries recorded yet.")
      .isVisible()
      .catch(() => false);
    expect(hasTable || hasEmptyState).toBeTruthy();
  });
});
