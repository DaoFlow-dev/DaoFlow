import { expect, test, type Page } from "@playwright/test";
import { signInAsOperator, signInAsOwner, trpcRequest } from "./helpers";

async function createEnvVarFixture(page: Page) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const project = await trpcRequest<{ id: string; name: string }>(page, "createProject", {
    name: `E2E Env ${suffix}`
  });
  const environment = await trpcRequest<{ id: string; name: string }>(page, "createEnvironment", {
    projectId: project.id,
    name: `staging-${suffix}`,
    targetServerId: "srv_foundation_1"
  });

  return { project, environment, suffix };
}

test.describe("Environment variables", () => {
  test("env var write path stores metadata and masks secrets without secret-read access", async ({
    page
  }) => {
    await signInAsOperator(page);

    const { environment } = await createEnvVarFixture(page);

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

  test("service environment tab lists inherited values, saves overrides, and keeps raw mode safe", async ({
    page
  }) => {
    await signInAsOwner(page);

    const { project, environment, suffix } = await createEnvVarFixture(page);
    const service = await trpcRequest<{ id: string; name: string }>(page, "createService", {
      name: `api-${suffix}`,
      environmentId: environment.id,
      projectId: project.id,
      sourceType: "image",
      imageReference: "nginx:alpine",
      port: "8080"
    });

    await trpcRequest(page, "upsertEnvironmentVariable", {
      environmentId: environment.id,
      key: "API_URL",
      value: "https://shared.example.test",
      isSecret: false,
      category: "runtime",
      source: "inline"
    });
    await trpcRequest(page, "upsertEnvironmentVariable", {
      environmentId: environment.id,
      key: "POSTGRES_PASSWORD",
      value: "shared-secret-value",
      isSecret: true,
      category: "runtime",
      source: "inline"
    });
    await trpcRequest(page, "upsertEnvironmentVariable", {
      environmentId: environment.id,
      key: "NPM_TOKEN",
      value: "npm-secret-value",
      isSecret: true,
      category: "build",
      source: "inline"
    });

    await page.goto(`/services/${service.id}`);
    await expect(page.getByRole("heading", { name: service.name })).toBeVisible();

    await page.getByRole("tab", { name: "Environment" }).click();
    await expect(page.getByTestId(`service-environment-tab-${service.id}`)).toBeVisible();

    await expect(page.getByTestId(`service-envvar-summary-layers-${service.id}`)).toContainText(
      "3"
    );
    await expect(page.getByTestId(`service-envvar-summary-service-${service.id}`)).toContainText(
      "0"
    );
    await expect(page.getByTestId(`service-envvar-summary-preview-${service.id}`)).toContainText(
      "0"
    );
    await expect(page.getByText("Shared environment value").first()).toBeVisible();
    await expect(
      page.getByTestId(`service-envvar-resolved-value-${service.id}-POSTGRES_PASSWORD`)
    ).toHaveText("[secret]");

    await page
      .getByTestId(`service-envvar-resolved-reveal-${service.id}-POSTGRES_PASSWORD`)
      .click();
    await expect(
      page.getByTestId(`service-envvar-resolved-value-${service.id}-POSTGRES_PASSWORD`)
    ).toHaveText("shared-secret-value");
    await expect(page.getByTestId(`service-build-summary-layers-${service.id}`)).toContainText("1");
    await expect(page.getByTestId(`service-build-summary-secrets-${service.id}`)).toContainText(
      "1"
    );
    await expect(
      page.getByTestId(`service-build-resolved-value-${service.id}-NPM_TOKEN`)
    ).toHaveText("[secret]");

    await page.getByTestId(`service-envvar-new-key-${service.id}`).fill("API_URL");
    await page
      .getByTestId(`service-envvar-new-value-${service.id}`)
      .fill("https://service.example.test");
    await page.getByTestId(`service-envvar-add-${service.id}`).click();

    await expect(page.getByTestId(`service-envvar-summary-layers-${service.id}`)).toContainText(
      "3"
    );
    await expect(page.getByTestId(`service-envvar-summary-service-${service.id}`)).toContainText(
      "1"
    );
    await expect(page.getByTestId(`service-envvar-resolved-${service.id}-API_URL`)).toContainText(
      "https://service.example.test"
    );

    await page.getByTestId(`service-envvar-new-key-${service.id}`).fill("API_URL");
    await page
      .getByTestId(`service-envvar-new-value-${service.id}`)
      .fill("https://preview.example.test");
    await page.getByTestId(`service-envvar-new-branch-${service.id}`).fill("preview/*");
    await page.getByTestId(`service-envvar-add-${service.id}`).click();

    await expect(page.getByTestId(`service-envvar-summary-layers-${service.id}`)).toContainText(
      "4"
    );
    await expect(page.getByTestId(`service-envvar-summary-service-${service.id}`)).toContainText(
      "2"
    );
    await expect(page.getByTestId(`service-envvar-summary-preview-${service.id}`)).toContainText(
      "1"
    );
    await expect(page.getByText("preview/*").first()).toBeVisible();

    await page.getByTestId(`service-envvar-new-key-${service.id}`).fill("ASSET_BUCKET");
    await page.getByTestId(`service-envvar-new-value-${service.id}`).fill("build-artifacts");
    await page.getByTestId(`service-envvar-new-category-${service.id}`).selectOption("build");
    await page.getByTestId(`service-envvar-add-${service.id}`).click();

    await expect(page.getByTestId(`service-build-summary-layers-${service.id}`)).toContainText("2");
    await expect(page.getByTestId(`service-build-summary-resolved-${service.id}`)).toContainText(
      "2"
    );
    await expect(
      page.getByTestId(`service-build-resolved-${service.id}-ASSET_BUCKET`)
    ).toContainText("Service override");

    const serviceInventory = await trpcRequest<{
      summary: {
        totalVariables: number;
        serviceOverrides?: number;
        previewOverrides?: number;
        resolvedVariables?: number;
      };
      resolvedVariables: Array<{
        key: string;
        displayValue: string;
        scopeLabel: string;
        branchPattern: string | null;
      }>;
    }>(page, "environmentVariables", {
      environmentId: environment.id,
      serviceId: service.id,
      limit: 100
    });

    expect(serviceInventory.summary.totalVariables).toBe(6);
    expect(serviceInventory.summary.serviceOverrides).toBe(3);
    expect(serviceInventory.summary.previewOverrides).toBe(1);
    expect(serviceInventory.summary.resolvedVariables).toBe(4);
    expect(serviceInventory.resolvedVariables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "API_URL",
          displayValue: "https://service.example.test",
          scopeLabel: "Service override",
          branchPattern: null
        }),
        expect.objectContaining({
          key: "POSTGRES_PASSWORD",
          scopeLabel: "Shared environment value",
          branchPattern: null
        }),
        expect.objectContaining({
          key: "ASSET_BUCKET",
          displayValue: "build-artifacts",
          scopeLabel: "Service override",
          branchPattern: null
        }),
        expect.objectContaining({
          key: "NPM_TOKEN",
          displayValue: "npm-secret-value",
          isSecret: true,
          category: "build",
          scopeLabel: "Shared environment value",
          branchPattern: null
        })
      ])
    );

    await page.getByTestId(`service-envvar-mode-raw-${service.id}`).click();
    await expect(page.getByTestId("service-envvar-raw-text")).toHaveValue(
      "API_URL=https://service.example.test"
    );
    await expect(page.getByText(/preview-only overrides stay out of raw mode/i)).toBeVisible();
  });
});
