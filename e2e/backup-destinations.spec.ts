import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Backup destination management (rclone)", () => {
  test("destinations page loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/destinations");
    await expect(page.getByRole("heading", { name: "Backup Destinations" })).toBeVisible();
  });

  test("add destination dialog opens and shows provider options", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");

    // Click "Add Destination" button
    await page.getByTestId("destination-add-button").click();
    const dialog = page.getByTestId("destination-dialog");
    await expect(dialog.getByText("Add Backup Destination")).toBeVisible();

    await expect(dialog.getByTestId("destination-provider-select")).toBeVisible();
  });

  test("create local destination and verify in table", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");
    const destinationName = `E2E Local Backup ${Date.now()}`;

    // Open dialog
    await page.getByTestId("destination-add-button").click();
    const dialog = page.getByTestId("destination-dialog");
    await expect(dialog.getByText("Add Backup Destination")).toBeVisible();

    // Fill name
    await dialog.getByLabel("Name").fill(destinationName);

    // Select "Local Filesystem" provider — click the Select trigger button
    await dialog.getByTestId("destination-provider-select").click();
    await page.getByText("Local Filesystem").click();
    await dialog.getByTestId("destination-local-path").fill("/tmp/daoflow-e2e-backups");

    // Submit — look for a button that creates/saves
    await dialog.getByTestId("destination-create-button").click();

    // Wait for the destination to appear in the list
    await expect(page.getByText(destinationName)).toBeVisible({ timeout: 10_000 });
  });

  test("test connection shows result badge", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");
    const destinationName = `E2E Local Backup ${Date.now()}`;

    await page.getByTestId("destination-add-button").click();
    const dialog = page.getByTestId("destination-dialog");
    await dialog.getByLabel("Name").fill(destinationName);
    await dialog.getByTestId("destination-provider-select").click();
    await page.getByText("Local Filesystem").click();
    await dialog.getByTestId("destination-local-path").fill("/tmp/daoflow-e2e-backups");
    await dialog.getByTestId("destination-create-button").click();
    await expect(page.getByText(destinationName)).toBeVisible({ timeout: 10_000 });

    // Click test connection button
    const row = page.locator("tr", { hasText: destinationName });
    await row.getByTestId("destination-test-button").click();

    // Wait for badge to update (Connected or Failed)
    await expect(row.getByText("Connected").or(row.getByText("Failed")).first()).toBeVisible({
      timeout: 15_000
    });
  });

  test("delete destination removes from table", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");
    const destinationName = `E2E Local Backup ${Date.now()}`;

    await page.getByTestId("destination-add-button").click();
    const dialog = page.getByTestId("destination-dialog");
    await dialog.getByLabel("Name").fill(destinationName);
    await dialog.getByTestId("destination-provider-select").click();
    await page.getByText("Local Filesystem").click();
    await dialog.getByTestId("destination-local-path").fill("/tmp/daoflow-e2e-backups");
    await dialog.getByTestId("destination-create-button").click();
    await expect(page.getByText(destinationName)).toBeVisible({ timeout: 10_000 });

    // Click delete button
    const row = page.locator("tr", { hasText: destinationName });
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByTestId("destination-delete-button").click();

    // Wait for row to disappear
    await expect(page.getByText(destinationName)).not.toBeVisible({ timeout: 10_000 });
  });

  test("provider-specific fields show for S3", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/destinations");

    await page.getByTestId("destination-add-button").click();
    const dialog = page.getByTestId("destination-dialog");
    await expect(dialog.getByText("Add Backup Destination")).toBeVisible();

    // S3 is default provider — should show S3-specific fields
    await expect(dialog.getByText("Access Key")).toBeVisible();
    await expect(dialog.getByText("Secret Key")).toBeVisible();
    await expect(dialog.getByText("Bucket")).toBeVisible();
    await expect(dialog.getByText("Region")).toBeVisible();
    await expect(dialog.getByText("Endpoint")).toBeVisible();
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
