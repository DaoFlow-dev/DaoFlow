import { expect, test } from "@playwright/test";
import { signInAsOwner, OWNER_EMAIL } from "./helpers";

test.describe("Approval workflows", () => {
  test("request approval for backup restore → approve", async ({ page }) => {
    await signInAsOwner(page);

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
      .filter({ hasText: OWNER_EMAIL })
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
        .filter({ hasText: OWNER_EMAIL })
    ).toBeVisible();
  });

  test("seed approval data is present", async ({ page }) => {
    await signInAsOwner(page);

    await expect(page.getByText("Approval queue")).toBeVisible();
    await expect(page.getByTestId("approval-summary")).toContainText("1");
  });
});
