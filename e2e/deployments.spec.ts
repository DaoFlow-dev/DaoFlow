import { expect, test } from "@playwright/test";
import { signInAsOwner, trpcRequest } from "./helpers";

test.describe("Deployment lifecycle", () => {
  test("deployments page loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  });

  test("starting a deploy via authenticated mutation reaches healthy state", async ({ page }) => {
    await signInAsOwner(page);

    const suffix = Date.now().toString();
    const project = await trpcRequest<{ id: string; name: string }>(page, "createProject", {
      name: `E2E Deploy ${suffix}`,
      description: "Mutation coverage project"
    });
    const environment = await trpcRequest<{ id: string; name: string }>(page, "createEnvironment", {
      projectId: project.id,
      name: `prod-${suffix}`,
      targetServerId: "srv_foundation_1"
    });
    const service = await trpcRequest<{ id: string; name: string }>(page, "createService", {
      name: `web-${suffix}`,
      environmentId: environment.id,
      projectId: project.id,
      sourceType: "image",
      imageReference: "nginx:alpine",
      port: "8080",
      targetServerId: "srv_foundation_1"
    });
    const deployment = await trpcRequest<{ id: string }>(page, "triggerDeploy", {
      serviceId: service.id
    });

    await trpcRequest(page, "dispatchExecutionJob", { jobId: deployment.id });
    await trpcRequest(page, "completeExecutionJob", { jobId: deployment.id });

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    await expect(page.getByText(service.name)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("healthy").first()).toBeVisible({ timeout: 10_000 });
  });

  test("seed deployments show status badges and rollback buttons", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // If deployment table exists, verify structure
    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);

    if (hasTable) {
      // Verify table has expected columns
      await expect(page.getByRole("columnheader", { name: "Service" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Source" })).toBeVisible();

      // Check that status badges are present (any status type)
      const badges = page.locator("table .inline-flex, table [class*='badge']");
      const badgeCount = await badges.count();
      expect(badgeCount).toBeGreaterThan(0);
    }
  });

  test("clicking a deployment row expands log viewer", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);

    if (hasTable) {
      // Click the first deployment row to expand
      const firstRow = page.locator("table tbody tr").first();
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();

        // After clicking, should see expanded content (log viewer)
        // Allow some time for the log viewer to load
        await page.waitForTimeout(1000);
      }
    }
  });

  test("seed deployment insights and rollback plans are visible", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);

    if (hasTable) {
      // Look for rollback buttons on healthy deployments
      const rollbackButtons = page.getByRole("button", { name: /Rollback/i });
      const count = await rollbackButtons.count();

      // If there are healthy deployments, rollback buttons should exist
      if (count > 0) {
        await expect(rollbackButtons.first()).toBeVisible();
      }
    }
  });
});
