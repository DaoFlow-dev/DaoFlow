import { expect, test } from "@playwright/test";
import { signInAsOperator, signInAsOwner, signOut, trpcRequest } from "./helpers";

test.describe("Approval workflows", () => {
  test("settings page security tab shows audit and approval context", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("tab", { name: "Security" }).click();

    // Security & Audit card should be visible — approvals are part of the audit trail
    await expect(page.getByText("Security & Audit")).toBeVisible();
  });

  test("approval request must be handed off to a different operator for approval", async ({
    page
  }) => {
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

    const blockedApproval = await page.evaluate(async (requestId) => {
      const res = await fetch("/trpc/approveApprovalRequest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
        credentials: "include"
      });

      return {
        status: res.status,
        body: await res.text()
      };
    }, request.id);

    expect(blockedApproval.status).toBe(412);
    expect(blockedApproval.body).toContain("different principal");

    await signOut(page);
    await signInAsOperator(page);

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
