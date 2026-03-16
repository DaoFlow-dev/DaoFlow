import { expect, test } from "@playwright/test";

test.describe("Database migration and health", () => {
  test("health endpoint returns healthy", async ({ request }) => {
    const response = await request.get("/trpc/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.result.data).toMatchObject({ status: "healthy" });
  });

  test("platform overview loads with architecture data", async ({ request }) => {
    const response = await request.get("/trpc/platformOverview");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    const data = body.result.data;
    expect(data.currentSlice).toBeDefined();
    expect(data.architecture.controlPlane).toBeDefined();
    expect(data.architecture.executionPlane).toBeDefined();
  });

  test("page loads after migration — redirects to login", async ({ page }) => {
    await page.goto("/");

    // Unauthenticated users should be redirected to login page
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "DaoFlow", level: 1 })).toBeVisible();
  });
});
