import { expect, test } from "@playwright/test";
import { getCurrentSession, signOut, signUpWithEmailPassword } from "./helpers";

test("clean DB bootstrap assigns owner first and blocks uninvited users", async ({ page }) => {
  const ownerEmail = `bootstrap-owner+${Date.now()}@daoflow.local`;
  const viewerEmail = `bootstrap-viewer+${Date.now()}@daoflow.local`;

  await signUpWithEmailPassword(page, {
    name: "Bootstrap Owner",
    email: ownerEmail,
    password: "bootstrap-owner-pass-2026"
  });

  const ownerSession = await getCurrentSession(page);
  expect(ownerSession.user.email).toBe(ownerEmail);
  expect(ownerSession.user.role).toBe("owner");

  await signOut(page);

  await page.goto("/login");
  await page.getByRole("tab", { name: "Sign up" }).click();
  await page.getByTestId("login-signup-name").fill("Bootstrap Viewer");
  await page.getByTestId("login-signup-email").fill(viewerEmail);
  await page.getByTestId("login-signup-password").fill("bootstrap-viewer-pass-2026");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByTestId("login-signup-feedback")).toContainText(
    "A team invitation is required to create a DaoFlow account."
  );
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});
