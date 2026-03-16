import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Server management", () => {
  test("servers page loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    // Navigate to servers page
    await page.getByRole("link", { name: "Servers" }).click();
    await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();
  });

  test.skip("register a new server and verify infrastructure inventory", async () => {
    // Pending: server registration form not yet implemented on new ServersPage
  });

  test.skip("seed servers show in readiness panel with connectivity status", async () => {
    // Pending: readiness panel details not yet on new ServersPage
  });
});
