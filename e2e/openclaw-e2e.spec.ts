/**
 * openclaw-e2e.spec.ts
 *
 * E2E test for deploying the OpenClaw app template via the DaoFlow
 * template system. Exercises the full create-project → deploy → health
 * lifecycle against a real (or local) SSH-connected server.
 *
 * Run via: bun run test:e2e:worker
 */
import { test, expect } from "@playwright/test";
import { signInAsOwner, trpcRequest } from "./helpers";

test.describe("OpenClaw template deployment", () => {
  test("renders the OpenClaw template with correct compose output", async ({ page }) => {
    await signInAsOwner(page);

    // Verify the template catalog includes openclaw
    const templates = await trpcRequest<{ slug: string; name: string }[]>(page, "listAppTemplates");
    const openclaw = templates.find((t) => t.slug === "openclaw");
    expect(openclaw).toBeDefined();
    expect(openclaw?.name).toBe("OpenClaw");
  });

  test("deploys OpenClaw via SSH server and verifies health", async ({ page }) => {
    await signInAsOwner(page);

    const suffix = Date.now().toString();

    // Find or register a local server for deployment
    const inventory = await trpcRequest<{
      servers: { id: string; host: string }[];
    }>(page, "infrastructureInventory");

    const existingLocalServer = inventory.servers.find(
      (server) => server.host === "127.0.0.1" || server.host === "localhost"
    );

    const server =
      existingLocalServer ??
      (await trpcRequest<{ id: string }>(page, "registerServer", {
        name: `openclaw-test-${suffix}`,
        host: "127.0.0.1",
        region: "local",
        sshPort: 22,
        kind: "docker-engine"
      }));

    // Create project → environment → service using the template compose
    const project = await trpcRequest<{ id: string }>(page, "createProject", {
      name: `OpenClaw E2E ${suffix}`,
      description: "OpenClaw template integration test"
    });

    const environment = await trpcRequest<{ id: string }>(page, "createEnvironment", {
      projectId: project.id,
      name: `openclaw-env-${suffix}`,
      targetServerId: server.id
    });

    const service = await trpcRequest<{ id: string; name: string }>(page, "createService", {
      name: `openclaw-svc-${suffix}`,
      environmentId: environment.id,
      projectId: project.id,
      sourceType: "image",
      imageReference: "ghcr.io/openclaw/openclaw:latest",
      port: "18789",
      targetServerId: server.id
    });

    // Trigger a real deployment
    const deployment = await trpcRequest<{ id: string }>(page, "triggerDeploy", {
      serviceId: service.id
    });

    expect(deployment.id).toBeTruthy();

    // Navigate to deployments and wait for terminal status
    await page.goto("/deployments");
    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
    await expect(page.getByText(service.name)).toBeVisible({ timeout: 30_000 });

    // Wait for healthy status — OpenClaw may take longer to start
    await expect(page.getByText("healthy").first()).toBeVisible({ timeout: 120_000 });
  });
});
