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
  await expect(page.getByText("Recent deployments")).toBeVisible();
  await expect(
    page.getByTestId("deployment-card-dep_foundation_20260312_1")
  ).toContainText("production-us-west");
  await expect(
    page.getByTestId("deployment-card-dep_foundation_20260312_1")
  ).toContainText("Resolve compose spec");
  await expect(page.getByText("Better Auth + tRPC protected procedure")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("session-state")).toHaveText("signed out");
});
