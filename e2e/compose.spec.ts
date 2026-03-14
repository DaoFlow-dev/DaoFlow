import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Compose releases and drift", () => {
  test("seed compose release catalog is visible", async ({ page }) => {
    await signInAsOwner(page);

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
  });

  test("compose drift inspector shows seed drifts", async ({ page }) => {
    await signInAsOwner(page);

    await expect(page.getByText("Compose drift inspector")).toBeVisible();
    await expect(page.getByTestId("compose-drift-summary")).toContainText("3");
    await expect(
      page.getByTestId("compose-drift-card-compose_daoflow_prod_control_plane")
    ).toContainText("ghcr.io/daoflow/control-plane:0.1.0-rc1");
    await expect(
      page.getByTestId("compose-drift-card-compose_daoflow_staging_control_plane")
    ).toContainText("crash-loop");
  });

  test("queue a compose release", async ({ page }) => {
    await signInAsOwner(page);

    const form = page.getByTestId("compose-release-form");
    await form.getByLabel("Commit SHA").fill("babe999");
    await form.getByLabel("Image override").fill("ghcr.io/daoflow/control-plane:1.0.0");
    await form.getByRole("button", { name: "Queue compose release" }).click();

    await expect(page.getByTestId("compose-release-feedback")).toContainText(
      "Queued compose release for control-plane"
    );

    // Verify deployment card
    await expect(
      page
        .locator('[data-testid^="deployment-card-"]')
        .filter({ hasText: "Source: compose" })
        .filter({ hasText: "Commit: babe999" })
    ).toContainText("ghcr.io/daoflow/control-plane:1.0.0");
  });
});
