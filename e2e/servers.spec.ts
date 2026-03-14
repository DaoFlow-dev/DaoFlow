import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Server management", () => {
  test("register a new server and verify infrastructure inventory", async ({ page }) => {
    await signInAsOwner(page);

    // Verify seed servers exist
    await expect(page.getByText("Servers, projects, and environments")).toBeVisible();
    await expect(page.getByTestId("server-card-srv_foundation_1")).toContainText(
      "foundation-vps-1"
    );

    // Register a new server
    const serverName = `test-vps-${Date.now()}`;
    const serverHost = `192.168.1.${(Date.now() % 200) + 10}`;
    await page.getByLabel("Server name").fill(serverName);
    await page.getByLabel("Server host").fill(serverHost);
    await page.getByLabel("Server region").fill("eu-west-1");
    await page.getByLabel("SSH port").fill("2222");
    await page.getByRole("button", { name: "Register server" }).click();

    // Verify feedback
    await expect(page.getByTestId("server-onboarding-feedback")).toContainText(
      `Registered ${serverName}`
    );

    // Verify server appears in inventory
    await expect(
      page.locator('[data-testid^="server-card-"]').filter({ hasText: serverName })
    ).toContainText("pending verification");

    // Verify server readiness shows pending
    await expect(
      page.locator('[data-testid^="server-readiness-card-"]').filter({ hasText: serverName })
    ).toContainText("SSH handshake has not succeeded yet for this host.");
  });

  test("seed servers show in readiness panel with connectivity status", async ({ page }) => {
    await signInAsOwner(page);

    await expect(page.getByText("Server readiness and onboarding")).toBeVisible();
    await expect(page.getByTestId("server-readiness-summary")).toContainText("24 ms");
    await expect(page.getByTestId("server-readiness-card-srv_foundation_1")).toContainText(
      "Connectivity checks are healthy."
    );
  });
});
