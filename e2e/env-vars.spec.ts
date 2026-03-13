import { expect, test } from "@playwright/test";

async function signUpAsOwner(page: import("@playwright/test").Page) {
  const email = `env-owner+${Date.now()}@daoflow.local`;
  await page.goto("/");
  await page.getByLabel("Name").fill("Env Admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("secret1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("signed in");
  return email;
}

test.describe("Environment variables", () => {
  test("seed environment variables are visible", async ({ page }) => {
    await signUpAsOwner(page);

    await expect(page.getByText("Encrypted environment configuration")).toBeVisible();
    await expect(page.getByTestId("environment-variable-summary")).toContainText("3");
    await expect(
      page.getByTestId("environment-variable-card-envvar_prod_database_password")
    ).toContainText("Value: [secret]");
    await expect(
      page.getByTestId("environment-variable-card-envvar_staging_preview_flag")
    ).toContainText("Branch pattern: preview/*");
  });

  test("save a runtime environment variable", async ({ page }) => {
    await signUpAsOwner(page);

    await page.getByLabel("Key").fill("API_BASE_URL");
    await page.getByLabel("Value", { exact: true }).fill("https://api.daoflow.dev");
    await page.getByRole("button", { name: "Save variable" }).click();

    await expect(page.getByTestId("environment-variable-feedback")).toContainText(
      "Saved API_BASE_URL for staging"
    );

    // Verify card appears
    await expect(
      page
        .locator('[data-testid^="environment-variable-card-"]')
        .filter({ hasText: "API_BASE_URL" })
    ).toContainText("https://api.daoflow.dev");
  });

  test("save a secret environment variable shows masked value", async ({ page }) => {
    await signUpAsOwner(page);

    await page.getByLabel("Key").fill("DB_PASSWORD");
    await page.getByLabel("Value", { exact: true }).fill("super-secret-pw");
    await page.getByLabel("Secret value").check();
    await page.getByRole("button", { name: "Save variable" }).click();

    await expect(page.getByTestId("environment-variable-feedback")).toContainText(
      "Saved DB_PASSWORD for staging"
    );

    // Secret should be masked
    await expect(
      page.locator('[data-testid^="environment-variable-card-"]').filter({ hasText: "DB_PASSWORD" })
    ).toContainText("Value: [secret]");
  });

  test("save a build variable with branch pattern", async ({ page }) => {
    await signUpAsOwner(page);

    await page.getByLabel("Key").fill("FEATURE_FLAG");
    await page.getByLabel("Value", { exact: true }).fill("true");
    await page.getByLabel("Branch pattern").fill("feature/*");
    await page.getByRole("button", { name: "Save variable" }).click();

    await expect(page.getByTestId("environment-variable-feedback")).toContainText(
      "Saved FEATURE_FLAG for staging"
    );

    await expect(
      page
        .locator('[data-testid^="environment-variable-card-"]')
        .filter({ hasText: "FEATURE_FLAG" })
    ).toContainText("Branch pattern: feature/*");
  });
});
