import { expect, test } from "@playwright/test";

async function signUpAsOwner(page: import("@playwright/test").Page) {
  const email = `bak-owner+${Date.now()}@daoflow.local`;
  await page.goto("/");
  await page.getByLabel("Name").fill("Backup Admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("secret1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("signed in");
  return email;
}

test.describe("Backup and restore workflows", () => {
  test("seed backup data is visible", async ({ page }) => {
    await signUpAsOwner(page);

    await expect(page.getByText("Backup policies and runs")).toBeVisible();
    await expect(page.getByTestId("backup-summary")).toContainText("2");
    await expect(page.getByText("Backup restore queue")).toBeVisible();
    await expect(page.getByTestId("restore-summary")).toContainText("1");
    await expect(page.getByTestId("backup-restore-brestore_vol_verify")).toContainText(
      "/var/lib/postgresql/data"
    );
  });

  test("trigger a backup run from policy", async ({ page }) => {
    await signUpAsOwner(page);

    await page
      .locator('[data-testid^="backup-policy-"]')
      .filter({ hasText: "postgres-volume" })
      .getByRole("button", { name: "Queue backup" })
      .click();

    await expect(page.getByTestId("backup-feedback")).toContainText(
      "Queued backup run for postgres-volume"
    );

    // Verify new run appears with queued status
    await expect(
      page.locator('[data-testid^="backup-run-"]').filter({ hasText: "postgres-volume" }).first()
    ).toContainText("queued");
  });

  test("queue a restore drill from a successful backup run", async ({ page }) => {
    await signUpAsOwner(page);

    await page
      .locator('[data-testid^="backup-run-"]')
      .filter({ hasText: "postgres-volume" })
      .filter({ hasText: "succeeded" })
      .getByRole("button", { name: "Queue restore" })
      .click();

    await expect(page.getByTestId("restore-feedback")).toContainText(
      "Queued restore drill for postgres-volume"
    );

    await expect(
      page.locator('[data-testid^="backup-restore-"]').filter({ hasText: "queued" }).first()
    ).toContainText("foundation-vps-1:/var/lib/postgresql/data");
  });
});
