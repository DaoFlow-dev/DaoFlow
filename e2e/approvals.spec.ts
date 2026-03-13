import { expect, test } from "@playwright/test";

async function signUpAsOwner(page: import("@playwright/test").Page) {
  const email = `apr-owner+${Date.now()}@daoflow.local`;
  await page.goto("/");
  await page.getByLabel("Name").fill("Approval Admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("secret1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("signed in");
  return email;
}

test.describe("Approval workflows", () => {
  test("request approval for backup restore → approve", async ({ page }) => {
    const email = await signUpAsOwner(page);

    // Request approval via backup run action
    await page
      .locator('[data-testid^="backup-run-"]')
      .filter({ hasText: "postgres-volume" })
      .filter({ hasText: "succeeded" })
      .getByRole("button", { name: "Request approval" })
      .click();

    await expect(page.getByTestId("approval-feedback")).toContainText(
      "Requested approval for backup-restore on postgres-volume"
    );

    // Find the pending approval
    const approval = page
      .locator('[data-testid^="approval-request-"]')
      .filter({ hasText: email })
      .filter({ hasText: "backup-restore" })
      .first();
    await expect(approval).toContainText("pending");

    // Approve it
    await approval.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("approval-feedback")).toContainText("Approved backup-restore");
    await expect(approval).toContainText("approved");

    // Verify audit trail
    await expect(
      page
        .locator('[data-testid^="audit-entry-"]')
        .filter({ hasText: "approval.approve" })
        .filter({ hasText: email })
    ).toBeVisible();
  });

  test("seed approval data is present", async ({ page }) => {
    await signUpAsOwner(page);

    await expect(page.getByText("Approval queue")).toBeVisible();
    await expect(page.getByTestId("approval-summary")).toContainText("1");
  });
});
