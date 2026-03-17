import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Backup destination management (rclone)", () => {
  test("destinations page loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to destinations page via sidebar
    await page.getByRole("link", { name: "Destinations" }).click();
    await expect(page.getByRole("heading", { name: "Backup Destinations" })).toBeVisible();
  });

  test("shows empty state when no destinations configured", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");

    // Should show empty state text
    await expect(page.getByText("No backup destinations configured")).toBeVisible({
      timeout: 10_000
    });
  });

  test("add destination dialog opens and shows provider options", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");

    // Click "Add Destination" button
    await page.getByRole("button", { name: "Add Destination" }).click();
    await expect(page.getByText("Add Backup Destination")).toBeVisible();

    // Should have the provider label
    await expect(page.getByText("Provider", { exact: true })).toBeVisible();
  });

  test("create local destination and verify in table", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");

    // Open dialog
    await page.getByRole("button", { name: "Add Destination" }).click();
    await expect(page.getByText("Add Backup Destination")).toBeVisible();

    // Fill name
    await page.getByLabel("Name").fill("E2E Local Backup");

    // Select "Local Filesystem" provider — click the Select trigger button
    const selectButton = page.locator("button[role='combobox']");
    if (await selectButton.isVisible().catch(() => false)) {
      await selectButton.click();
      // Click the "Local Filesystem" option in the dropdown
      await page.getByText("Local Filesystem").click();
    }

    // Fill local path (only visible for local provider)
    const localPathInput = page.getByLabel("Local Path");
    if (await localPathInput.isVisible().catch(() => false)) {
      await localPathInput.fill("/tmp/daoflow-e2e-backups");
    }

    // Submit — look for a button that creates/saves
    const createBtn = page.getByRole("button", { name: /Create|Save/ });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
    }

    // Wait for the destination to appear in the list
    await expect(page.getByText("E2E Local Backup")).toBeVisible({ timeout: 10_000 });
  });

  test("test connection shows result badge", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");

    // Ensure there is at least one destination
    const hasDestinations = await page
      .getByText("E2E Local Backup")
      .isVisible()
      .catch(() => false);
    if (!hasDestinations) {
      test.skip();
      return;
    }

    // Click test connection button
    await page.getByTitle("Test Connection").first().click();

    // Wait for badge to update (Connected or Failed)
    await expect(page.getByText("Connected").or(page.getByText("Failed")).first()).toBeVisible({
      timeout: 15_000
    });
  });

  test("delete destination removes from table", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");

    // Check if the test destination exists
    const hasDestinations = await page
      .getByText("E2E Local Backup")
      .isVisible()
      .catch(() => false);
    if (!hasDestinations) {
      test.skip();
      return;
    }

    // Setup dialog handler for confirm
    page.on("dialog", (dialog) => void dialog.accept());

    // Click delete button
    await page.getByTitle("Delete").first().click();

    // Wait for row to disappear
    await expect(page.getByText("E2E Local Backup")).not.toBeVisible({ timeout: 10_000 });
  });

  test("provider-specific fields show for S3", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");

    await page.getByRole("button", { name: "Add Destination" }).click();
    await expect(page.getByText("Add Backup Destination")).toBeVisible();

    // S3 is default provider — should show S3-specific fields
    await expect(page.getByText("Access Key")).toBeVisible();
    await expect(page.getByText("Secret Key")).toBeVisible();
    await expect(page.getByText("Bucket")).toBeVisible();
    await expect(page.getByText("Region")).toBeVisible();
    await expect(page.getByText("Endpoint")).toBeVisible();
  });

  test("backups page shows destination names instead of s3-compatible", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/backups");
    await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();

    // Should NOT show legacy "s3-compatible" text
    const hasLegacy = await page
      .getByText("s3-compatible")
      .isVisible()
      .catch(() => false);
    expect(hasLegacy).toBe(false);
  });
});
