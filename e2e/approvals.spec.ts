import { expect, test } from "@playwright/test";
import { signInAsOperator, signInAsOwner, signOut, trpcRequest } from "./helpers";

test.describe("Approval workflows", () => {
  test("approval queue shows pending requests and blocks self-approval", async ({ page }) => {
    await signInAsOwner(page);

    const request = await trpcRequest<{ id: string; status: string; actionType: string }>(
      page,
      "requestApproval",
      {
        actionType: "compose-release",
        composeServiceId: "compose_daoflow_prod_control_plane",
        commitSha: "abcdef1",
        imageTag: "ghcr.io/daoflow/control-plane:e2e-self-approval",
        reason: "Need operator approval before promoting the compose release in e2e."
      }
    );

    expect(request.status).toBe("pending");

    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();

    const approvalCard = page.getByTestId(`approval-request-${request.id}`);
    await expect(approvalCard).toContainText("compose-release");
    await expect(approvalCard).toContainText("pending");
    await expect(approvalCard).toContainText(
      "Need operator approval before promoting the compose release in e2e."
    );

    await approvalCard.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("approval-feedback")).toContainText("different principal");
    await expect(approvalCard).toContainText("pending");
  });

  test("operator can approve and reject requests from the approvals page", async ({ page }) => {
    await signInAsOwner(page);

    const approvedRequest = await trpcRequest<{ id: string; status: string }>(
      page,
      "requestApproval",
      {
        actionType: "compose-release",
        composeServiceId: "compose_daoflow_prod_control_plane",
        commitSha: "abcdef2",
        imageTag: "ghcr.io/daoflow/control-plane:e2e-approve",
        reason: "Need operator approval before promoting the first compose release in e2e."
      }
    );
    const rejectedRequest = await trpcRequest<{ id: string; status: string }>(
      page,
      "requestApproval",
      {
        actionType: "compose-release",
        composeServiceId: "compose_daoflow_prod_control_plane",
        commitSha: "abcdef3",
        imageTag: "ghcr.io/daoflow/control-plane:e2e-reject",
        reason: "Need operator approval before promoting the second compose release in e2e."
      }
    );

    await signOut(page);
    await signInAsOperator(page);

    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();

    const approvalSummary = page.getByTestId("approval-summary");
    await expect(approvalSummary).toContainText("Requests");
    await expect(approvalSummary).toContainText("Pending");

    const approvedCard = page.getByTestId(`approval-request-${approvedRequest.id}`);
    const rejectedCard = page.getByTestId(`approval-request-${rejectedRequest.id}`);

    await expect(approvedCard).toContainText("pending");
    await expect(rejectedCard).toContainText("pending");

    await approvedCard.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("approval-feedback")).toContainText("Approved compose-release");
    await expect(approvedCard).toContainText("approved");
    await expect(approvedCard).toContainText("Decision:");
    await expect(approvedCard.getByRole("button", { name: "Approve" })).toHaveCount(0);

    await rejectedCard.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByTestId("approval-feedback")).toContainText("Rejected compose-release");
    await expect(rejectedCard).toContainText("rejected");
    await expect(rejectedCard).toContainText("Decision:");
    await expect(rejectedCard.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });
});
