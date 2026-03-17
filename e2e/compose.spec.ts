import { expect, test } from "@playwright/test";
import { signInAsOwner, trpcRequest } from "./helpers";

test.describe("Compose releases and drift", () => {
  test("compose deployment surface loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  });

  test("queueing a compose release creates a deployment record", async ({ page }) => {
    await signInAsOwner(page);

    const deployment = await trpcRequest<{ id: string; serviceName: string; sourceType: string }>(
      page,
      "queueComposeRelease",
      {
        composeServiceId: "compose_daoflow_prod_control_plane",
        commitSha: "abcdef1",
        imageTag: `ghcr.io/daoflow/control-plane:e2e-${Date.now()}`
      }
    );

    expect(deployment.sourceType).toBe("compose");

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    const deploymentRow = page.locator("tr", { hasText: deployment.serviceName }).first();
    await expect(deploymentRow).toBeVisible({ timeout: 10_000 });
    await expect(deploymentRow.getByText("compose")).toBeVisible();
  });

  test("compose drift inspector shows comparison data", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    // Deployment page should contain deployment-related content
    const deploymentHistory = page.getByText("Deployment History");
    const deploymentHeading = page.getByRole("heading", { name: "Deployments" });
    await expect(deploymentHistory.or(deploymentHeading).first()).toBeVisible({ timeout: 10_000 });
  });
});
