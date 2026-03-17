import { expect, test } from "@playwright/test";
import { signInAsOwner, trpcRequest } from "./helpers";

test.describe("Approval workflows", () => {
  test("settings page security tab shows audit and approval context", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Security" }).click();

    // Security & Audit card should be visible — approvals are part of the audit trail
    await expect(page.getByText("Security & Audit")).toBeVisible();
  });

  test("approval request can be created and approved end-to-end", async ({ page }) => {
    await signInAsOwner(page);

    const request = await trpcRequest<{ id: string; status: string; actionType: string }>(
      page,
      "requestApproval",
      {
        actionType: "backup-restore",
        backupRunId: "brun_foundation_volume_success",
        reason: "Need operator approval before replaying backup artifact in e2e."
      }
    );

    expect(request.status).toBe("pending");

    const approved = await trpcRequest<{ id: string; status: string }>(
      page,
      "approveApprovalRequest",
      {
        requestId: request.id
      }
    );

    expect(approved.status).toBe("approved");
  });
});
