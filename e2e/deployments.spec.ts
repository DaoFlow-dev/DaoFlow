import { expect, test } from "@playwright/test";
import { signInAsOwner, OWNER_EMAIL } from "./helpers";

test.describe("Deployment lifecycle", () => {
  test("create deployment → dispatch → mark healthy", async ({ page }) => {
    await signInAsOwner(page);

    // Fill deployment form
    const form = page.getByTestId("manual-deployment-form");
    await form.getByLabel("Service name").fill("api-gateway");
    await form.getByLabel("Commit SHA").fill("abc1234");
    await form.getByLabel("Image tag").fill("ghcr.io/daoflow/api-gateway:1.0.0");
    await page.getByRole("button", { name: "Queue deployment record" }).click();

    // Verify deployment created
    await expect(page.getByTestId("deployment-feedback")).toContainText("Queued api-gateway");

    // Verify deployment card rendered
    const depCard = page
      .locator('[data-testid^="deployment-card-"]')
      .filter({ hasText: "api-gateway" });
    await expect(depCard).toContainText(`Requested by ${OWNER_EMAIL}`);
    await expect(depCard).toContainText("Commit: abc1234");

    // Verify execution job appears
    const job = page.locator('[data-testid^="execution-job-"]').filter({ hasText: "api-gateway" });
    await expect(job).toContainText("Queue: docker-ssh");

    // Dispatch the job
    await job.getByRole("button", { name: "Dispatch" }).click();
    await expect(page.getByTestId("execution-feedback")).toContainText("Dispatched api-gateway");
    await expect(job).toContainText("dispatched");

    // Mark healthy
    await job.getByRole("button", { name: "Mark healthy" }).click();
    await expect(page.getByTestId("execution-feedback")).toContainText(
      "Marked api-gateway healthy"
    );
    await expect(job).toContainText("completed");
    await expect(depCard).toContainText("healthy");

    // Verify audit trail entry
    await expect(
      page
        .locator('[data-testid^="audit-entry-"]')
        .filter({ hasText: "execution.complete" })
        .filter({ hasText: "api-gateway" })
    ).toContainText(OWNER_EMAIL);

    // Verify deployment log
    await expect(
      page
        .locator('[data-testid^="deployment-log-line-"]')
        .filter({ hasText: "api-gateway reported healthy" })
    ).toBeVisible();

    // Verify timeline event
    await expect(
      page
        .locator('[data-testid^="timeline-event-"]')
        .filter({ hasText: "Deployment reached a healthy state." })
        .filter({ hasText: "api-gateway" })
    ).toBeVisible();
  });

  test("create deployment → dispatch → mark failed", async ({ page }) => {
    await signInAsOwner(page);

    const form = page.getByTestId("manual-deployment-form");
    await form.getByLabel("Service name").fill("broken-svc");
    await form.getByLabel("Commit SHA").fill("dead123");
    await form.getByLabel("Image tag").fill("ghcr.io/daoflow/broken:0.0.1");
    await page.getByRole("button", { name: "Queue deployment record" }).click();
    await expect(page.getByTestId("deployment-feedback")).toContainText("Queued broken-svc");

    const job = page.locator('[data-testid^="execution-job-"]').filter({ hasText: "broken-svc" });

    // Dispatch
    await job.getByRole("button", { name: "Dispatch" }).click();
    await expect(job).toContainText("dispatched");

    // Mark failed
    await job.getByRole("button", { name: "Mark failed" }).click();
    await expect(page.getByTestId("execution-feedback")).toContainText("Marked broken-svc failed");
    await expect(job).toContainText("failed");
  });

  test("seed deployment insights and rollback plans are visible", async ({ page }) => {
    await signInAsOwner(page);

    // Deployment insights
    await expect(page.getByText("Agent-ready deployment diagnostics")).toBeVisible();
    await expect(page.getByTestId("deployment-insight-dep_foundation_20260311_1")).toContainText(
      "Health check failed"
    );
    await expect(page.getByTestId("deployment-insight-dep_foundation_20260311_1")).toContainText(
      "Healthy baseline: 03e40ca"
    );

    // Rollback plans
    await expect(page.getByRole("heading", { name: "Rollback planning", level: 2 })).toBeVisible();
    await expect(page.getByTestId("rollback-plan-dep_foundation_20260311_1")).toContainText(
      "Rollback target: 03e40ca"
    );
    await expect(page.getByTestId("rollback-plan-dep_foundation_20260312_1")).toContainText(
      "Current deployment is already healthy"
    );
  });
});
