import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("RBAC and agent tokens", () => {
  test("owner can see agent token inventory", async ({ page }) => {
    await signInAsOwner(page);

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
    await signInAsOwner(page);

    await expect(page.getByText("Immutable control-plane audit trail")).toBeVisible();
    await expect(page.getByTestId("audit-summary")).toBeVisible();
    await expect(page.getByTestId("audit-entry-4002")).toContainText("execution.complete");
  });

  test("owner sees deployment logs", async ({ page }) => {
    await signInAsOwner(page);

    await expect(page.getByText("Append-only deployment logs")).toBeVisible();
    await expect(page.getByTestId("log-summary")).toBeVisible();
    await expect(page.getByTestId("deployment-log-line-3005")).toContainText(
      "Container exited with code 1 during readiness probe."
    );
  });

  test("owner sees persistent volume registry", async ({ page }) => {
    await signInAsOwner(page);

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
    await signInAsOwner(page);
    await expect(page.getByText("Better Auth + tRPC protected procedure")).toBeVisible();
  });
});
