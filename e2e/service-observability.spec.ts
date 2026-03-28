import { expect, test } from "@playwright/test";
import { signInAsAdmin, signInAsPlatformOwner, trpcRequest } from "./helpers";

test.describe("Service detail: deployment logs & terminal", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  /**
   * Creates a throwaway project/environment/service and triggers a
   * deployment so the deployment-log viewer has real data to render.
   */
  async function seedServiceWithDeployment(page: import("@playwright/test").Page) {
    const suffix = Date.now().toString();

    const project = await trpcRequest<{ id: string }>(page, "createProject", {
      name: `E2E LogTerm ${suffix}`,
      description: "E2E deployment log and terminal test"
    });

    const environment = await trpcRequest<{ id: string }>(page, "createEnvironment", {
      projectId: project.id,
      name: `env-${suffix}`,
      targetServerId: "srv_foundation_1"
    });

    const service = await trpcRequest<{ id: string; name: string }>(page, "createService", {
      name: `svc-${suffix}`,
      environmentId: environment.id,
      projectId: project.id,
      sourceType: "image",
      imageReference: "nginx:alpine",
      port: "80",
      targetServerId: "srv_foundation_1"
    });

    // Trigger + complete a deployment so logs are generated
    const deployment = await trpcRequest<{ id: string }>(page, "triggerDeploy", {
      serviceId: service.id,
      imageTag: `ghcr.io/daoflow/e2e-logterm:${suffix}`
    });
    await trpcRequest(page, "dispatchExecutionJob", { jobId: deployment.id });
    await trpcRequest(page, "completeExecutionJob", { jobId: deployment.id });

    return service;
  }

  test("deployment log viewer renders readable entries when a deployment row is expanded", async ({
    page
  }) => {
    const service = await seedServiceWithDeployment(page);

    await page.goto(`/services/${service.id}`);
    await expect(page.getByRole("heading", { name: service.name })).toBeVisible({
      timeout: 10_000
    });

    // Switch to Deployments tab
    await page.getByRole("tab", { name: "Deployments" }).click();

    // Wait for deployment cards to load, then expand the first one
    const deploymentButton = page
      .locator("button")
      .filter({ has: page.locator("span.font-mono") })
      .first();
    await expect(deploymentButton).toBeVisible({ timeout: 10_000 });
    await deploymentButton.click();

    // Verify the log viewer search field appears (proves the component mounted)
    const logSearch = page.getByPlaceholder("Search deployment logs...");
    await expect(logSearch).toBeVisible({ timeout: 10_000 });

    // Verify the log container element is present
    const logContainer = page.locator("[role='log']");
    await expect(logContainer).toBeVisible();

    // Container should have a dark background class
    await expect(logContainer).toHaveClass(/bg-zinc-950/);

    // The stream filter bar should be functional
    const allButton = page
      .locator("[data-testid*='deployment-logs-stream']")
      .filter({ hasText: "All" });
    await expect(allButton).toBeVisible();

    // Count badge should be visible
    const countBadge = page.locator("[data-testid*='deployment-logs-count']");
    await expect(countBadge).toBeVisible();
    const countText = await countBadge.textContent();
    expect(countText).toContain("match");
  });

  test("terminal tab explains restricted shell access for deploy-capable admins", async ({
    page
  }) => {
    const service = await seedServiceWithDeployment(page);

    await page.goto(`/services/${service.id}`);
    await expect(page.getByRole("heading", { name: service.name })).toBeVisible({
      timeout: 10_000
    });

    await expect(page.getByTestId("service-detail-terminal-restricted-badge")).toHaveText(
      "Restricted"
    );

    // Switch to Logs tab first to confirm read-only diagnostics remain available
    await page.getByRole("tab", { name: "Logs" }).click();
    await expect(page.getByTestId(`logs-card-${service.id}`)).toBeVisible({ timeout: 10_000 });

    // Switch to Terminal tab
    await page.getByRole("tab", { name: "Terminal" }).click();

    await expect(page.getByTestId("terminal-access-blocked-alert")).toContainText(
      "Terminal access needs a separate permission."
    );
    await expect(page.getByTestId("terminal-access-help")).toContainText(
      "Ask an owner to handle break-glass troubleshooting"
    );
    await expect(page.getByTestId(`terminal-card-${service.id}`)).toHaveCount(0);
  });
});

test.describe("Service detail: owner terminal access", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsPlatformOwner(page);
  });

  test("terminal tab renders terminal card with shell selector and help text for owners", async ({
    page
  }) => {
    const suffix = Date.now().toString();

    const project = await trpcRequest<{ id: string }>(page, "createProject", {
      name: `E2E Owner LogTerm ${suffix}`,
      description: "Owner terminal access test"
    });

    const environment = await trpcRequest<{ id: string }>(page, "createEnvironment", {
      projectId: project.id,
      name: `env-owner-${suffix}`,
      targetServerId: "srv_foundation_1"
    });

    const service = await trpcRequest<{ id: string; name: string }>(page, "createService", {
      name: `svc-owner-${suffix}`,
      environmentId: environment.id,
      projectId: project.id,
      sourceType: "image",
      imageReference: "nginx:alpine",
      port: "80",
      targetServerId: "srv_foundation_1"
    });

    await page.goto(`/services/${service.id}`);
    await expect(page.getByRole("heading", { name: service.name })).toBeVisible({
      timeout: 10_000
    });

    await page.getByRole("tab", { name: "Terminal" }).click();

    const terminalCard = page.getByTestId(`terminal-card-${service.id}`);
    await expect(terminalCard).toBeVisible({ timeout: 10_000 });
    await expect(terminalCard.getByText("Docker Terminal")).toBeVisible();
    await expect(page.getByTestId(`terminal-shell-${service.id}-bash`)).toBeVisible();
    await expect(page.getByTestId(`terminal-shell-${service.id}-sh`)).toBeVisible();
    await expect(page.getByTestId(`terminal-output-${service.id}`)).toBeVisible();
    await expect(page.getByTestId(`terminal-status-${service.id}`)).toBeVisible();
    await expect(page.getByTestId(`terminal-help-${service.id}`)).toHaveText(
      "Type commands and press Enter. Ctrl+C to interrupt, Ctrl+D to detach."
    );
    await expect(page.getByTestId("terminal-access-blocked-alert")).toHaveCount(0);
  });
});
