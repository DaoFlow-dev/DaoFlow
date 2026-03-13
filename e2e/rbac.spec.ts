import { expect, test } from "@playwright/test";

async function signUpAsOwner(page: import("@playwright/test").Page) {
  const email = `rbac-owner+${Date.now()}@daoflow.local`;
  await page.goto("/");
  await page.getByLabel("Name").fill("RBAC Admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("secret1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("signed in");
  return email;
}

test.describe("RBAC and agent tokens", () => {
  test("owner can see agent token inventory", async ({ page }) => {
    await signUpAsOwner(page);

    await expect(page.getByText("Scoped automation identities")).toBeVisible();
    await expect(page.getByTestId("token-summary")).toContainText("3");
    await expect(page.getByTestId("token-card-token_observer_readonly")).toContainText(
      "readonly-observer"
    );
    await expect(page.getByTestId("token-card-token_observer_readonly")).toContainText(
      "read.projects"
    );
    await expect(page.getByTestId("token-card-token_planner_agent")).toContainText("agents.plan");
  });

  test("owner sees full audit trail", async ({ page }) => {
    await signUpAsOwner(page);

    await expect(page.getByText("Immutable control-plane audit trail")).toBeVisible();
    await expect(page.getByTestId("audit-summary")).toContainText("3");
    await expect(page.getByTestId("audit-entry-audit_foundation_execution_complete")).toContainText(
      "execution.complete"
    );
  });

  test("owner sees deployment logs", async ({ page }) => {
    await signUpAsOwner(page);

    await expect(page.getByText("Append-only deployment logs")).toBeVisible();
    await expect(page.getByTestId("log-summary")).toContainText("6");
    await expect(page.getByTestId("deployment-log-line-log_foundation_failed_2")).toContainText(
      "Container exited with code 1 during readiness probe."
    );
  });

  test("owner sees persistent volume registry", async ({ page }) => {
    await signUpAsOwner(page);

    await expect(page.getByText("Persistent volume registry")).toBeVisible();
    await expect(page.getByTestId("persistent-volume-summary")).toContainText("Needs attention");
    await expect(
      page.getByTestId("persistent-volume-card-pvol_daoflow_postgres_prod")
    ).toContainText("Backup policy: bpol_foundation_volume_daily");
    await expect(
      page.getByTestId("persistent-volume-card-pvol_daoflow_uploads_prod")
    ).toContainText("Backup policy: Unmanaged");
  });

  test("Better Auth + tRPC protected procedure heading visible after auth", async ({ page }) => {
    await signUpAsOwner(page);
    await expect(page.getByText("Better Auth + tRPC protected procedure")).toBeVisible();
  });
});
