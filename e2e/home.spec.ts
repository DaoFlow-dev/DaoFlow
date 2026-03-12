import { expect, test } from "@playwright/test";

test("loads the DaoFlow foundation dashboard", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "DaoFlow", level: 1 })
  ).toBeVisible();
  await expect(page.getByText("Docker-first control plane")).toBeVisible();
  await expect(page.getByText("healthy")).toBeVisible();
  await expect(page.getByText("Foundation slice")).toHaveCount(4);

  const email = `operator+${Date.now()}@daoflow.local`;
  await page.getByLabel("Name").fill("DaoFlow Operator");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("secret1234");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByTestId("session-state")).toHaveText("signed in");
  await expect(page.getByTestId("session-email")).toHaveText(email);
  await expect(page.getByTestId("auth-summary")).toContainText(email);
  await expect(page.getByTestId("auth-role")).toContainText("owner");
  await expect(page.getByTestId("role-state")).toHaveText("owner");
  await expect(page.getByTestId("viewer-output")).toContainText(email);
  await expect(page.getByTestId("viewer-output")).toContainText('"role": "owner"');
  await expect(page.getByTestId("admin-output")).toContainText('"defaultSignupRole": "viewer"');
  await expect(page.getByText("Servers, projects, and environments")).toBeVisible();
  await expect(page.getByTestId("inventory-summary")).toContainText("3");
  await expect(page.getByTestId("server-card-srv_foundation_1")).toContainText("foundation-vps-1");
  await expect(page.getByTestId("server-card-srv_foundation_1")).toContainText("Docker Engine 28.0");
  await expect(
    page.getByTestId("project-card-proj_daoflow_control_plane")
  ).toContainText("https://github.com/daoflow/daoflow");
  await expect(
    page.getByTestId("environment-card-env_daoflow_production")
  ).toContainText("/srv/daoflow/production/compose.yaml");
  await expect(page.getByText("Queued and historical deployments")).toBeVisible();
  await expect(page.getByText("Agent-ready deployment diagnostics")).toBeVisible();
  await expect(
    page.getByTestId("deployment-insight-dep_foundation_20260311_1")
  ).toContainText("Health check failed and left the deployment unhealthy.");
  await expect(
    page.getByTestId("deployment-insight-dep_foundation_20260311_1")
  ).toContainText("Healthy baseline: 03e40ca");
  await expect(page.getByText("Worker handoff queue")).toBeVisible();
  await expect(
    page.getByTestId("deployment-card-dep_foundation_20260312_1")
  ).toContainText("production-us-west");
  await expect(
    page.getByTestId("deployment-card-dep_foundation_20260312_1")
  ).toContainText("Resolve compose spec");
  await expect(
    page.getByTestId("deployment-card-dep_foundation_20260312_1")
  ).toContainText("Requested by owner@daoflow.local");
  await page.getByLabel("Service name").fill("edge-worker-ui");
  await page.getByLabel("Commit SHA").fill("abcdef1");
  await page.getByLabel("Image tag").fill("ghcr.io/daoflow/edge-worker-ui:0.2.1");
  await page.getByRole("button", { name: "Queue deployment record" }).click();
  await expect(page.getByTestId("deployment-feedback")).toContainText("Queued edge-worker-ui");
  await expect(
    page.locator('[data-testid^="deployment-card-"]').filter({ hasText: "edge-worker-ui" })
  ).toContainText(`Requested by ${email}`);
  await expect(page.getByTestId("queue-summary")).toContainText("1");
  await expect(
    page.locator('[data-testid^="execution-job-"]').filter({ hasText: "edge-worker-ui" })
  ).toContainText("Queue: docker-ssh");
  await page
    .locator('[data-testid^="execution-job-"]')
    .filter({ hasText: "edge-worker-ui" })
    .getByRole("button", { name: "Dispatch" })
    .click();
  await expect(page.getByTestId("execution-feedback")).toContainText("Dispatched edge-worker-ui");
  await expect(
    page.locator('[data-testid^="execution-job-"]').filter({ hasText: "edge-worker-ui" })
  ).toContainText("dispatched");
  await page
    .locator('[data-testid^="execution-job-"]')
    .filter({ hasText: "edge-worker-ui" })
    .getByRole("button", { name: "Mark healthy" })
    .click();
  await expect(page.getByTestId("execution-feedback")).toContainText("Marked edge-worker-ui healthy");
  await expect(
    page.locator('[data-testid^="execution-job-"]').filter({ hasText: "edge-worker-ui" })
  ).toContainText("completed");
  await expect(
    page.locator('[data-testid^="deployment-card-"]').filter({ hasText: "edge-worker-ui" })
  ).toContainText("healthy");
  await expect(
    page.locator('[data-testid^="timeline-event-"]').filter({
      hasText: "Deployment reached a healthy state."
    })
  ).toContainText("edge-worker-ui");
  await expect(page.getByText("Scoped automation identities")).toBeVisible();
  await expect(page.getByText("Backup policies and runs")).toBeVisible();
  await expect(page.getByTestId("backup-summary")).toContainText("2");
  await page
    .locator('[data-testid^="backup-policy-"]')
    .filter({ hasText: "postgres-volume" })
    .getByRole("button", { name: "Queue backup" })
    .click();
  await expect(page.getByTestId("backup-feedback")).toContainText("Queued backup run for postgres-volume");
  await expect(
    page.locator('[data-testid^="backup-run-"]').filter({ hasText: "postgres-volume" }).first()
  ).toContainText("queued");
  await expect(page.getByTestId("token-summary")).toContainText("3");
  await expect(
    page.getByTestId("token-card-token_observer_readonly")
  ).toContainText("readonly-observer");
  await expect(
    page.getByTestId("token-card-token_observer_readonly")
  ).toContainText("read.projects");
  await expect(page.getByTestId("token-card-token_planner_agent")).toContainText(
    "agents.plan"
  );
  await expect(page.getByText("Better Auth + tRPC protected procedure")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("signed out");
});
