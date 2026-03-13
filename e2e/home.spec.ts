import { expect, test } from "@playwright/test";

test("loads the DaoFlow foundation dashboard", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "DaoFlow", level: 1 })).toBeVisible();
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
  await expect(page.getByTestId("server-card-srv_foundation_1")).toContainText(
    "Docker Engine 28.0"
  );
  await expect(page.getByTestId("project-card-proj_daoflow_control_plane")).toContainText(
    "https://github.com/daoflow/daoflow"
  );
  await expect(page.getByTestId("environment-card-env_daoflow_production")).toContainText(
    "/srv/daoflow/production/compose.yaml"
  );
  await expect(page.getByText("Server readiness and onboarding")).toBeVisible();
  await expect(page.getByTestId("server-readiness-summary")).toContainText("24 ms");
  await expect(page.getByTestId("server-readiness-card-srv_foundation_1")).toContainText(
    "Connectivity checks are healthy."
  );
  await expect(
    page.getByRole("heading", { name: "Compose release catalog", level: 2 })
  ).toBeVisible();
  await expect(page.getByTestId("compose-release-summary")).toContainText("5");
  await expect(
    page.getByTestId("compose-service-card-compose_daoflow_prod_control_plane")
  ).toContainText("/srv/daoflow/production/compose.yaml");
  await expect(
    page.getByTestId("compose-service-card-compose_daoflow_prod_control_plane")
  ).toContainText("Dependencies: postgres, redis");
  await expect(page.getByText("Compose drift inspector")).toBeVisible();
  await expect(page.getByTestId("compose-drift-summary")).toContainText("3");
  await expect(
    page.getByTestId("compose-drift-card-compose_daoflow_prod_control_plane")
  ).toContainText("ghcr.io/daoflow/control-plane:0.1.0-rc1");
  await expect(
    page.getByTestId("compose-drift-card-compose_daoflow_staging_control_plane")
  ).toContainText("crash-loop");
  await expect(page.getByText("Encrypted environment configuration")).toBeVisible();
  await expect(page.getByTestId("environment-variable-summary")).toContainText("3");
  await expect(
    page.getByTestId("environment-variable-card-envvar_prod_database_password")
  ).toContainText("Value: [secret]");
  await expect(
    page.getByTestId("environment-variable-card-envvar_staging_preview_flag")
  ).toContainText("Branch pattern: preview/*");
  await expect(page.getByText("Persistent volume registry")).toBeVisible();
  await expect(page.getByTestId("persistent-volume-summary")).toContainText("Needs attention");
  await expect(page.getByTestId("persistent-volume-card-pvol_daoflow_postgres_prod")).toContainText(
    "Backup policy: bpol_foundation_volume_daily"
  );
  await expect(page.getByTestId("persistent-volume-card-pvol_daoflow_uploads_prod")).toContainText(
    "Backup policy: Unmanaged"
  );
  await expect(page.getByText("Queued and historical deployments")).toBeVisible();
  await expect(page.getByText("Agent-ready deployment diagnostics")).toBeVisible();
  await expect(page.getByTestId("deployment-insight-dep_foundation_20260311_1")).toContainText(
    "Health check failed and left the deployment unhealthy."
  );
  await expect(page.getByTestId("deployment-insight-dep_foundation_20260311_1")).toContainText(
    "Healthy baseline: 03e40ca"
  );
  await expect(page.getByRole("heading", { name: "Rollback planning", level: 2 })).toBeVisible();
  await expect(page.getByTestId("rollback-plan-dep_foundation_20260311_1")).toContainText(
    "Rollback target: 03e40ca"
  );
  await expect(page.getByTestId("rollback-plan-dep_foundation_20260311_1")).toContainText(
    "Verify the target server is still reachable before issuing rollback commands."
  );
  await expect(page.getByTestId("rollback-plan-dep_foundation_20260311_1")).toContainText(
    "Replay environment variables and volume attachments from the rollback target snapshot."
  );
  await expect(page.getByTestId("rollback-plan-dep_foundation_20260312_1")).toContainText(
    "Current deployment is already healthy; rollback is not recommended."
  );
  await expect(page.getByText("Immutable control-plane audit trail")).toBeVisible();
  await expect(page.getByTestId("audit-summary")).toContainText("3");
  await expect(page.getByTestId("audit-entry-audit_foundation_execution_complete")).toContainText(
    "execution.complete"
  );
  await expect(page.getByText("Append-only deployment logs")).toBeVisible();
  await expect(page.getByTestId("log-summary")).toContainText("6");
  await expect(page.getByTestId("deployment-log-line-log_foundation_failed_2")).toContainText(
    "Container exited with code 1 during readiness probe."
  );
  await expect(page.getByText("Worker handoff queue")).toBeVisible();
  await expect(page.getByTestId("deployment-card-dep_foundation_20260312_1")).toContainText(
    "production-us-west"
  );
  await expect(page.getByTestId("deployment-card-dep_foundation_20260312_1")).toContainText(
    "Resolve compose spec"
  );
  await expect(page.getByTestId("deployment-card-dep_foundation_20260312_1")).toContainText(
    "Requested by owner@daoflow.local"
  );
  const uniqueServerName = `edge-vps-${Date.now()}`;
  const uniqueServerHost = `10.0.2.${(Date.now() % 200) + 10}`;
  await page.getByLabel("Server name").fill(uniqueServerName);
  await page.getByLabel("Server host").fill(uniqueServerHost);
  await page.getByLabel("Server region").fill("us-central-1");
  await page.getByLabel("SSH port").fill("2222");
  await page.getByRole("button", { name: "Register server" }).click();
  await expect(page.getByTestId("server-onboarding-feedback")).toContainText(
    `Registered ${uniqueServerName}`
  );
  await expect(
    page.locator('[data-testid^="server-readiness-card-"]').filter({ hasText: uniqueServerName })
  ).toContainText("SSH handshake has not succeeded yet for this host.");
  await expect(
    page.locator('[data-testid^="server-card-"]').filter({ hasText: uniqueServerName })
  ).toContainText("pending verification");
  const composeReleaseForm = page.getByTestId("compose-release-form");
  await composeReleaseForm.getByLabel("Commit SHA").fill("fedcba1");
  await composeReleaseForm.getByLabel("Image override").fill("ghcr.io/daoflow/control-plane:0.1.1");
  await composeReleaseForm.getByRole("button", { name: "Queue compose release" }).click();
  await expect(page.getByTestId("compose-release-feedback")).toContainText(
    "Queued compose release for control-plane"
  );
  await expect(
    page
      .locator('[data-testid^="deployment-card-"]')
      .filter({ hasText: "Source: compose" })
      .filter({
        hasText: "Commit: fedcba1"
      })
  ).toContainText("ghcr.io/daoflow/control-plane:0.1.1");
  const manualDeploymentForm = page.getByTestId("manual-deployment-form");
  await manualDeploymentForm.getByLabel("Service name").fill("edge-worker-ui");
  await manualDeploymentForm.getByLabel("Commit SHA").fill("abcdef1");
  await manualDeploymentForm.getByLabel("Image tag").fill("ghcr.io/daoflow/edge-worker-ui:0.2.1");
  await page.getByLabel("Key").fill("SERVICE_TOKEN");
  await page.getByLabel("Value", { exact: true }).fill("top-secret-token");
  await page.getByLabel("Branch pattern").fill("feature/*");
  await page.getByLabel("Secret value").check();
  await page.getByRole("button", { name: "Save variable" }).click();
  await expect(page.getByTestId("environment-variable-feedback")).toContainText(
    "Saved SERVICE_TOKEN for staging"
  );
  await expect(
    page.locator('[data-testid^="environment-variable-card-"]').filter({
      hasText: "SERVICE_TOKEN"
    })
  ).toContainText("Value: [secret]");
  await page.getByRole("button", { name: "Queue deployment record" }).click();
  await expect(page.getByTestId("deployment-feedback")).toContainText("Queued edge-worker-ui");
  await expect(
    page.locator('[data-testid^="deployment-card-"]').filter({ hasText: "edge-worker-ui" })
  ).toContainText(`Requested by ${email}`);
  await expect(
    page
      .locator('[data-testid^="audit-entry-"]')
      .filter({
        hasText: "deployment.create"
      })
      .filter({ hasText: "edge-worker-ui@staging" })
  ).toContainText(email);
  await expect(
    page.locator('[data-testid^="deployment-log-line-"]').filter({
      hasText: "Control plane queued edge-worker-ui"
    })
  ).toContainText("staging");
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
  await expect(page.getByTestId("execution-feedback")).toContainText(
    "Marked edge-worker-ui healthy"
  );
  await expect(
    page.locator('[data-testid^="execution-job-"]').filter({ hasText: "edge-worker-ui" })
  ).toContainText("completed");
  await expect(
    page.locator('[data-testid^="deployment-card-"]').filter({ hasText: "edge-worker-ui" })
  ).toContainText("healthy");
  await expect(
    page
      .locator('[data-testid^="audit-entry-"]')
      .filter({
        hasText: "execution.complete"
      })
      .filter({ hasText: "edge-worker-ui@staging" })
  ).toContainText(email);
  await expect(
    page.locator('[data-testid^="deployment-log-line-"]').filter({
      hasText: "edge-worker-ui reported healthy"
    })
  ).toContainText("staging");
  await expect(
    page.locator('[data-testid^="timeline-event-"]').filter({
      hasText: "Deployment reached a healthy state."
    })
  ).toContainText("edge-worker-ui");
  await expect(page.getByText("Scoped automation identities")).toBeVisible();
  await expect(page.getByText("Backup policies and runs")).toBeVisible();
  await expect(page.getByTestId("backup-summary")).toContainText("2");
  await expect(page.getByText("Backup restore queue")).toBeVisible();
  await expect(page.getByTestId("restore-summary")).toContainText("1");
  await expect(page.getByTestId("backup-restore-brestore_vol_verify")).toContainText(
    "/var/lib/postgresql/data"
  );
  await expect(page.getByText("Approval queue")).toBeVisible();
  await expect(page.getByTestId("approval-summary")).toContainText("1");
  await page
    .locator('[data-testid^="backup-policy-"]')
    .filter({ hasText: "postgres-volume" })
    .getByRole("button", { name: "Queue backup" })
    .click();
  await expect(page.getByTestId("backup-feedback")).toContainText(
    "Queued backup run for postgres-volume"
  );
  await expect(
    page.locator('[data-testid^="backup-run-"]').filter({ hasText: "postgres-volume" }).first()
  ).toContainText("queued");
  await page
    .locator('[data-testid^="backup-run-"]')
    .filter({ hasText: "postgres-volume" })
    .filter({ hasText: "succeeded" })
    .getByRole("button", { name: "Queue restore" })
    .click();
  await expect(page.getByTestId("restore-feedback")).toContainText(
    "Queued restore drill for postgres-volume"
  );
  await expect(
    page.locator('[data-testid^="backup-restore-"]').filter({ hasText: "queued" }).first()
  ).toContainText("foundation-vps-1:/var/lib/postgresql/data");
  await page
    .locator('[data-testid^="backup-run-"]')
    .filter({ hasText: "postgres-volume" })
    .filter({ hasText: "succeeded" })
    .getByRole("button", { name: "Request approval" })
    .click();
  await expect(page.getByTestId("approval-feedback")).toContainText(
    "Requested approval for backup-restore on postgres-volume"
  );
  const requestedApproval = page
    .locator('[data-testid^="approval-request-"]')
    .filter({ hasText: email })
    .filter({ hasText: "backup-restore" })
    .first();
  await expect(requestedApproval).toContainText("pending");
  await requestedApproval.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("approval-feedback")).toContainText(
    "Approved backup-restore for postgres-volume@production-us-west"
  );
  await expect(requestedApproval).toContainText("approved");
  await expect(
    page
      .locator('[data-testid^="audit-entry-"]')
      .filter({
        hasText: "backup.trigger"
      })
      .filter({ hasText: "postgres-volume@production-us-west" })
  ).toContainText(email);
  await expect(
    page
      .locator('[data-testid^="audit-entry-"]')
      .filter({
        hasText: "approval.approve"
      })
      .filter({ hasText: "postgres-volume@production-us-west" })
  ).toContainText(email);
  await expect(
    page
      .locator('[data-testid^="audit-entry-"]')
      .filter({
        hasText: "backup.restore.queue"
      })
      .filter({ hasText: "postgres-volume@production-us-west" })
      .filter({ hasText: email })
  ).toHaveCount(2);
  await expect(page.getByTestId("token-summary")).toContainText("3");
  await expect(page.getByTestId("token-card-token_observer_readonly")).toContainText(
    "readonly-observer"
  );
  await expect(page.getByTestId("token-card-token_observer_readonly")).toContainText(
    "read.projects"
  );
  await expect(page.getByTestId("token-card-token_planner_agent")).toContainText("agents.plan");
  await expect(page.getByText("Better Auth + tRPC protected procedure")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("signed out");
});
