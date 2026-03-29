import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers";

test.describe("Onboarding", () => {
  test("setup wizard carries a new project into first-service and template continuation", async ({
    page
  }) => {
    await signInAsOwner(page);

    const suffix = Date.now().toString();
    const projectName = `Setup Journey ${suffix}`;
    const environmentName = `production-${suffix}`;
    const serverName = `setup-${suffix}`;
    const serverHost = `203.0.113.${(Number.parseInt(suffix.slice(-2), 10) % 200) + 1}`;

    await page.goto("/setup");
    await page.getByTestId("setup-welcome-continue").click();

    await expect(page.getByTestId("setup-server-step")).toBeVisible();
    await page.getByTestId("setup-server-name").fill(serverName);
    await page.getByTestId("setup-server-host").fill(serverHost);
    await page.getByTestId("setup-server-region").fill("us-west-2");
    await page.getByTestId("setup-server-submit").click();

    await expect(page.getByTestId("setup-project-step")).toBeVisible();
    await page.getByTestId("setup-project-name").fill(projectName);
    await page
      .getByTestId("setup-project-description")
      .fill("Browser onboarding regression coverage");
    await page
      .getByTestId("setup-project-repo")
      .fill("https://github.com/DaoFlow-dev/onboarding-e2e");
    await page.getByTestId("setup-project-submit").click();

    await expect(page.getByTestId("setup-environment-step")).toBeVisible();
    await page.getByTestId("setup-environment-name").fill(environmentName);
    await page.getByTestId("setup-environment-submit").click();

    await expect(page.getByTestId("setup-handoff-step")).toBeVisible();
    await expect(page.getByText(projectName)).toBeVisible();
    await expect(page.getByText(`${environmentName} on ${serverName}`)).toBeVisible();

    await page.getByTestId("setup-handoff-add-service-link").click();

    await expect(page.getByRole("heading", { name: "Add Service" })).toBeVisible();
    await expect(
      page.getByTestId("add-service-environment-select").locator("option:checked")
    ).toHaveText(environmentName);

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByText(`No services in ${environmentName} yet`)).toBeVisible();
    await page.getByTestId("project-services-empty-deploy-link").click();

    await expect(page).toHaveURL(/\/deploy\?source=template/);
    await expect(page.getByTestId("template-handoff-summary")).toContainText(
      `Deploying into ${projectName} / ${environmentName} on ${serverName}.`
    );
    await expect(page.getByTestId("template-project-name")).toHaveValue(projectName);
    await expect(page.getByTestId("template-project-name")).toBeDisabled();
  });
});
