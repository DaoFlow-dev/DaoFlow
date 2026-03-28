import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner, trpcRequest } from "./helpers";

interface DeploymentRecord {
  id: string;
  serviceId?: string | null;
  serviceName?: string | null;
  status?: string | null;
  imageTag?: string | null;
}

function unwrapTrpcPayload<T>(payload: unknown): T {
  const envelope = payload as {
    result?: {
      data?: {
        json?: T;
      } & T;
    };
    error?: {
      json?: {
        message?: string;
      };
    };
  };

  if (envelope.error?.json?.message) {
    throw new Error(envelope.error.json.message);
  }

  if (
    envelope.result?.data &&
    typeof envelope.result.data === "object" &&
    "json" in envelope.result.data
  ) {
    return envelope.result.data.json as T;
  }

  if (envelope.result?.data) {
    return envelope.result.data as T;
  }

  return payload as T;
}

async function recentDeployments(page: Page) {
  const response = await page
    .context()
    .request.get(`/trpc/recentDeployments?input=${encodeURIComponent('{"limit":50}')}`);

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok()) {
    const message =
      (payload as { error?: { json?: { message?: string } } } | null)?.error?.json?.message ??
      `recentDeployments failed with status ${response.status()}`;
    throw new Error(message);
  }

  return unwrapTrpcPayload<DeploymentRecord[]>(payload);
}

async function waitForRollbackDeployment(
  page: Page,
  input: { serviceId: string; stableTag: string; excludedDeploymentIds: string[] }
) {
  await expect
    .poll(
      async () => {
        const deployments = await recentDeployments(page);
        return (
          deployments.find(
            (deployment) =>
              deployment.serviceId === input.serviceId &&
              deployment.imageTag === input.stableTag &&
              !input.excludedDeploymentIds.includes(deployment.id)
          )?.id ?? null
        );
      },
      {
        timeout: 10_000
      }
    )
    .not.toBeNull();

  const deployments = await recentDeployments(page);
  const rollbackDeployment = deployments.find(
    (deployment) =>
      deployment.serviceId === input.serviceId &&
      deployment.imageTag === input.stableTag &&
      !input.excludedDeploymentIds.includes(deployment.id)
  );

  if (!rollbackDeployment) {
    throw new Error("Rollback deployment was not created.");
  }

  return rollbackDeployment;
}

async function runDeployment(page: Page, serviceId: string, imageTag: string) {
  const deployment = await trpcRequest<{ id: string }>(page, "triggerDeploy", {
    serviceId,
    imageTag
  });

  await trpcRequest(page, "dispatchExecutionJob", { jobId: deployment.id });
  await trpcRequest(page, "completeExecutionJob", { jobId: deployment.id });

  return deployment.id;
}

test.describe("Deployment lifecycle", () => {
  test("deployments page loads after sign-in", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  });

  test("starting a deploy via authenticated mutation reaches healthy state", async ({ page }) => {
    await signInAsOwner(page);

    const suffix = Date.now().toString();
    const project = await trpcRequest<{ id: string; name: string }>(page, "createProject", {
      name: `E2E Deploy ${suffix}`,
      description: "Mutation coverage project"
    });
    const environment = await trpcRequest<{ id: string; name: string }>(page, "createEnvironment", {
      projectId: project.id,
      name: `prod-${suffix}`,
      targetServerId: "srv_foundation_1"
    });
    const service = await trpcRequest<{ id: string; name: string }>(page, "createService", {
      name: `web-${suffix}`,
      environmentId: environment.id,
      projectId: project.id,
      sourceType: "image",
      imageReference: "nginx:alpine",
      port: "8080",
      targetServerId: "srv_foundation_1"
    });

    await runDeployment(page, service.id, `ghcr.io/daoflow/e2e-deploy:${suffix}`);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    await page.getByPlaceholder("Search by service name...").fill(service.name);

    const serviceRows = page.locator("table tbody tr").filter({ hasText: service.name });
    await expect(serviceRows).toHaveCount(1);
    await expect(serviceRows.first().getByText("healthy")).toBeVisible({ timeout: 10_000 });
  });

  test("rollback replays the selected healthy release and returns it to healthy", async ({
    page
  }) => {
    await signInAsOwner(page);

    const suffix = Date.now().toString();
    const stableTag = `ghcr.io/daoflow/e2e-lifecycle:${suffix}-stable`;
    const candidateTag = `ghcr.io/daoflow/e2e-lifecycle:${suffix}-candidate`;

    const project = await trpcRequest<{ id: string }>(page, "createProject", {
      name: `E2E Lifecycle ${suffix}`,
      description: "Deployment lifecycle rollback coverage"
    });
    const environment = await trpcRequest<{ id: string }>(page, "createEnvironment", {
      projectId: project.id,
      name: `prod-${suffix}`,
      targetServerId: "srv_foundation_1"
    });
    const service = await trpcRequest<{ id: string; name: string }>(page, "createService", {
      name: `rollout-${suffix}`,
      environmentId: environment.id,
      projectId: project.id,
      sourceType: "image",
      imageReference: stableTag,
      port: "8080",
      targetServerId: "srv_foundation_1"
    });

    const firstDeploymentId = await runDeployment(page, service.id, stableTag);
    const secondDeploymentId = await runDeployment(page, service.id, candidateTag);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    await page.getByPlaceholder("Search by service name...").fill(service.name);

    const serviceRows = page.locator("table tbody tr").filter({ hasText: service.name });
    await expect(serviceRows).toHaveCount(2);
    await expect(serviceRows.first().getByText("healthy")).toBeVisible();

    await serviceRows.first().getByRole("button", { name: "Rollback deployment" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Rollback Service")).toBeVisible();
    await expect(dialog.getByText(stableTag)).toBeVisible();
    await expect(dialog.getByText(candidateTag)).toBeVisible();

    await dialog.locator("button").filter({ hasText: stableTag }).click();
    await dialog.getByRole("button", { name: "Confirm Rollback" }).click();
    await expect(dialog).not.toBeVisible();

    const rollbackDeployment = await waitForRollbackDeployment(page, {
      serviceId: service.id,
      stableTag,
      excludedDeploymentIds: [firstDeploymentId, secondDeploymentId]
    });

    await trpcRequest(page, "dispatchExecutionJob", { jobId: rollbackDeployment.id });
    await trpcRequest(page, "completeExecutionJob", { jobId: rollbackDeployment.id });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    await page.getByPlaceholder("Search by service name...").fill(service.name);

    await expect(serviceRows).toHaveCount(3);
    await expect(serviceRows.first().getByText("healthy")).toBeVisible({ timeout: 10_000 });

    await serviceRows.first().click();
    await expect(page.getByText("Rollback preparation")).toBeVisible();
    await expect(page.getByText(stableTag)).toBeVisible();
  });

  test("clicking a deployment row expands log viewer", async ({ page }) => {
    await signInAsOwner(page);

    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

    const hasTable = await page
      .locator("table")
      .isVisible()
      .catch(() => false);

    if (hasTable) {
      const firstRow = page.locator("table tbody tr").first();
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();
        await expect(page.getByPlaceholder("Search deployment logs...")).toBeVisible();
      }
    }
  });
});
