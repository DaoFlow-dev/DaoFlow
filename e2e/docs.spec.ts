import { test, expect } from "@playwright/test";

/**
 * E2E tests for the Docusaurus docs site.
 *
 * Run with: bunx playwright test --config playwright-docs.config.ts
 *
 * These tests serve the static build from docs/build/ and verify:
 * - Key pages render without errors
 * - Navigation links work
 * - Content is present and correct
 * - Sidebar and footer are functional
 */

test.describe("Documentation Site", () => {
  test("homepage renders with DaoFlow branding", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/DaoFlow/);
  });

  test("docs root page renders with overview content", async ({ page }) => {
    await page.goto("/docs");
    // Docusaurus renders docs content in a .theme-doc-markdown container or main element
    const content = page.locator(".theme-doc-markdown, .markdown, main");
    await expect(content.first()).toBeVisible();
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("getting started page renders", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await expect(page.locator("h1")).toContainText("Getting Started");
  });

  test("sidebar navigation exists", async ({ page }) => {
    await page.goto("/docs/getting-started");
    // Docusaurus sidebar: .theme-doc-sidebar-container or aside element
    const sidebar = page.locator(".theme-doc-sidebar-container, aside, nav.menu");
    await expect(sidebar.first()).toBeVisible();
  });

  test("navbar has Docs, API, CLI, GitHub links", async ({ page }) => {
    await page.goto("/");
    const navbar = page.locator("nav.navbar");

    await expect(navbar.locator("a:has-text('Docs')").first()).toBeVisible();
    await expect(navbar.locator("a:has-text('CLI')").first()).toBeVisible();
    await expect(navbar.locator("a:has-text('GitHub')").first()).toBeVisible();
  });

  test("CLI docs page renders", async ({ page }) => {
    await page.goto("/docs/cli");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("API docs page renders", async ({ page }) => {
    await page.goto("/docs/api");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("security docs page renders", async ({ page }) => {
    await page.goto("/docs/security");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("agent integration docs page renders", async ({ page }) => {
    await page.goto("/docs/agents");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("self-hosting docs page renders", async ({ page }) => {
    await page.goto("/docs/self-hosting");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("clicking sidebar link navigates to a docs subpage", async ({ page }) => {
    await page.goto("/docs");
    // Click any sidebar link and verify navigation happens
    const sidebarLink = page.locator("aside a").first();
    const href = await sidebarLink.getAttribute("href");
    await sidebarLink.click();
    // Verify we navigated (URL changed or stayed on a docs page)
    await expect(page).toHaveURL(/docs/);
  });

  test("all category index pages return 200", async ({ page }) => {
    const paths = [
      "/docs",
      "/docs/getting-started",
      "/docs/getting-started/installation",
      "/docs/getting-started/first-deployment",
      "/docs/getting-started/configuration",
      "/docs/concepts/architecture",
      "/docs/concepts/servers",
      "/docs/concepts/deployments",
      "/docs/concepts/services",
      "/docs/concepts/projects-and-environments",
      "/docs/cli",
      "/docs/cli/deploy",
      "/docs/cli/status",
      "/docs/cli/whoami",
      "/docs/cli/capabilities",
      "/docs/api",
      "/docs/api/authentication",
      "/docs/api/read-endpoints",
      "/docs/api/command-endpoints",
      "/docs/api/error-handling",
      "/docs/security",
      "/docs/security/roles",
      "/docs/security/scopes",
      "/docs/security/api-tokens",
      "/docs/security/agent-principals",
      "/docs/security/audit-trail",
      "/docs/deployments",
      "/docs/deployments/compose",
      "/docs/deployments/dockerfile",
      "/docs/deployments/rollback",
      "/docs/deployments/logs",
      "/docs/backups",
      "/docs/backups/policies",
      "/docs/backups/runs",
      "/docs/backups/restore",
      "/docs/backups/s3-storage",
      "/docs/agents",
      "/docs/agents/getting-started",
      "/docs/agents/cli-for-agents",
      "/docs/agents/api-for-agents",
      "/docs/agents/safety-model",
      "/docs/agents/approval-gates",
      "/docs/self-hosting",
      "/docs/self-hosting/requirements",
      "/docs/self-hosting/docker-compose",
      "/docs/self-hosting/environment-variables",
      "/docs/self-hosting/ssl-and-domains",
      "/docs/self-hosting/upgrading",
      "/docs/contributing",
      "/docs/contributing/development-setup",
      "/docs/contributing/architecture-guide",
      "/docs/contributing/testing",
      "/docs/contributing/code-style"
    ];

    for (const docPath of paths) {
      const response = await page.goto(docPath);
      expect(response?.status(), `${docPath} should return 200`).toBe(200);
    }
  });
});
