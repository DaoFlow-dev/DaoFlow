import { expect, test } from "@playwright/test";

test.describe("Database migration and health", () => {
  test("health endpoint returns healthy", async ({ request }) => {
    const response = await request.get("/api/trpc/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.result.data).toMatchObject({ status: "healthy" });
  });

  test("platform overview loads with architecture data", async ({ request }) => {
    const response = await request.get("/api/trpc/platformOverview");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    const data = body.result.data;
    expect(data.currentSlice).toBeDefined();
    expect(data.architecture.controlPlane).toBeDefined();
    expect(data.architecture.executionPlane).toBeDefined();
  });

  test("page loads after migration — core sections render", async ({ page }) => {
    await page.goto("/");

    // Core landing page elements that require successful DB migration
    await expect(page.getByRole("heading", { name: "DaoFlow", level: 1 })).toBeVisible();
    await expect(page.getByText("Docker-first control plane")).toBeVisible();
    await expect(page.getByText("healthy")).toBeVisible();
    await expect(page.getByText("Foundation slice")).toHaveCount(4);
  });
});
