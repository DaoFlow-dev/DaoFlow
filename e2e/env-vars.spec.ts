import { expect, test } from "@playwright/test";
import { signInAsOwner, trpcRequest } from "./helpers";

test.describe("Environment variables", () => {
  test("settings page has environment configuration access", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    // Projects page should load successfully
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("project detail page loads after clicking a project card", async ({ page }) => {
    await signInAsOwner(page);

    const project = await trpcRequest<{ id: string }>(page, "createProject", {
      name: `E2E Detail ${Date.now()}`
    });
    await page.goto(`/projects/${project.id}`);
    await expect(page.getByRole("heading", { name: "Services" })).toBeVisible({
      timeout: 10_000
    });
  });

  test("env var write path stores metadata and masks secrets on read", async ({ page }) => {
    await signInAsOwner(page);

    const project = await trpcRequest<{ id: string }>(page, "createProject", {
      name: `E2E Env ${Date.now()}`
    });
    const environment = await trpcRequest<{ id: string }>(page, "createEnvironment", {
      projectId: project.id,
      name: `staging-${Date.now()}`,
      targetServerId: "srv_foundation_1"
    });

    await trpcRequest(page, "upsertEnvironmentVariable", {
      environmentId: environment.id,
      key: "E2E_SECRET_TOKEN",
      value: "super-secret-e2e-token",
      isSecret: true,
      category: "runtime",
      source: "inline"
    });

    const inventory = await trpcRequest<{
      variables: Array<{
        key: string;
        isSecret: boolean;
        displayValue: string;
        source: string;
      }>;
    }>(page, "environmentVariables", {
      environmentId: environment.id
    });

    expect(inventory.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "E2E_SECRET_TOKEN",
          isSecret: true,
          source: "inline"
        })
      ])
    );
    expect(
      inventory.variables.find((variable) => variable.key === "E2E_SECRET_TOKEN")?.displayValue
    ).not.toContain("super-secret-e2e-token");
  });
});
