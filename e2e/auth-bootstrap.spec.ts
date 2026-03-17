import { expect, test } from "@playwright/test";
import { getCurrentSession, signOut, signUpWithEmailPassword } from "./helpers";

test("clean DB bootstrap assigns owner first and viewer second", async ({ page }) => {
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

  await signUpWithEmailPassword(page, {
    name: "Bootstrap Viewer",
    email: viewerEmail,
    password: "bootstrap-viewer-pass-2026"
  });

  const viewerSession = await getCurrentSession(page);
  expect(viewerSession.user.email).toBe(viewerEmail);
  expect(viewerSession.user.role).toBe("viewer");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
