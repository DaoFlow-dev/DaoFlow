import type { Context } from "hono";
import { normalizeAppRole } from "@daoflow/shared";
import { auth } from "../auth";
import {
  getGitProvider,
  registerGitProvider,
  createGitInstallation
} from "../db/services/git-providers";

interface ManifestConversionResponse {
  id?: number;
  slug?: string;
  name?: string;
  client_id?: string;
  client_secret?: string;
  pem?: string;
  webhook_secret?: string;
  html_url?: string;
  owner?: { login?: string; type?: string };
}

function resolveSettingsRedirect(): string {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/settings`;
}

export async function handleGitHubAppSetup(c: Context) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.redirect(`${resolveSettingsRedirect()}?git_error=authentication_required`);
  }

  const role = normalizeAppRole((session.user as Record<string, unknown>).role);
  if (role !== "admin" && role !== "owner") {
    return c.redirect(`${resolveSettingsRedirect()}?git_error=admin_required`);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ ok: false, error: "Missing code or state parameter" }, 400);
  }

  const parts = state.split(":");
  const action = parts[0];

  if (action === "gh_init") {
    const conversionUrl = `https://api.github.com/app-manifests/${code}/conversions`;

    try {
      const response = await fetch(conversionUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "DaoFlow"
        }
      });

      if (!response.ok) {
        console.error(
          `[github-app-setup] Manifest conversion failed: ${response.status} ${await response.text()}`
        );
        return c.redirect(`${resolveSettingsRedirect()}?git_error=manifest_conversion_failed`);
      }

      const data = (await response.json()) as ManifestConversionResponse;
      if (!data.id || !data.client_id || !data.pem) {
        return c.redirect(`${resolveSettingsRedirect()}?git_error=incomplete_manifest_response`);
      }

      const providerResult = await registerGitProvider({
        type: "github",
        name: data.slug ?? data.name ?? `github-app-${data.id}`,
        appId: String(data.id),
        clientId: data.client_id,
        clientSecret: data.client_secret ?? undefined,
        privateKey: data.pem,
        webhookSecret: data.webhook_secret ?? undefined,
        requestedByUserId: session.user.id,
        requestedByEmail: session.user.email,
        requestedByRole: role
      });

      return c.redirect(
        `${resolveSettingsRedirect()}?git_setup=created&provider_id=${providerResult.summary.id}`
      );
    } catch (err) {
      console.error("[github-app-setup] Error during manifest conversion:", err);
      return c.redirect(`${resolveSettingsRedirect()}?git_error=manifest_conversion_failed`);
    }
  }

  if (action === "gh_setup") {
    const providerId = parts[1];
    const installationId = c.req.query("installation_id");
    const setupAction = c.req.query("setup_action");

    if (!providerId) {
      return c.json({ ok: false, error: "Invalid state — missing provider ID" }, 400);
    }

    const provider = await getGitProvider(providerId);
    if (!provider) {
      return c.redirect(`${resolveSettingsRedirect()}?git_error=provider_not_found`);
    }

    if (setupAction === "install" && installationId) {
      try {
        await createGitInstallation({
          providerId,
          installationId,
          accountName: c.req.query("account") || "Unknown",
          accountType: c.req.query("target_type") || "organization",
          requestedByUserId: session.user.id,
          requestedByEmail: session.user.email,
          requestedByRole: role
        });
      } catch (err) {
        console.error("[github-app-setup] Error creating installation:", err);
        return c.redirect(`${resolveSettingsRedirect()}?git_error=installation_failed`);
      }
    }

    return c.redirect(`${resolveSettingsRedirect()}?git_setup=installed&provider_id=${providerId}`);
  }

  return c.json({ ok: false, error: `Unknown setup action: ${action}` }, 400);
}
