import type { Context } from "hono";
import { normalizeAppRole } from "@daoflow/shared";
import { auth } from "../auth";
import { resolveGitProviderCallbackOrigin } from "../db/services/git-provider-callbacks";
import { consumeGitProviderSetupState } from "../db/services/git-provider-setup-states";
import {
  createGitInstallation,
  getGitProvider,
  registerGitProvider
} from "../db/services/git-providers";
import {
  fetchGitHubInstallationDetails,
  verifyGitHubInstallationForUser
} from "../db/services/github-app-auth";
import { isUserMemberOfTeam } from "../db/services/teams";

interface ManifestConversionResponse {
  id?: number;
  slug?: string;
  name?: string;
  client_id?: string;
  client_secret?: string;
  pem?: string;
  webhook_secret?: string;
}

function settingsRedirect(input: { origin: string; key: string; value: string }) {
  const url = new URL("/settings", `${input.origin}/`);
  url.searchParams.set(input.key, input.value);
  return url.toString();
}

function authenticationRedirect() {
  return settingsRedirect({
    origin: resolveGitProviderCallbackOrigin(),
    key: "git_error",
    value: "authentication_required"
  });
}

type GitHubSetupSessionLookup = (input: {
  headers: Headers;
}) => ReturnType<typeof auth.api.getSession>;

export function createGitHubAppSetupHandler(input?: { getSession?: GitHubSetupSessionLookup }) {
  const getSession = input?.getSession ?? ((request) => auth.api.getSession(request));

  return async function handleGitHubAppSetup(c: Context) {
    const session = await getSession({ headers: c.req.raw.headers });
    if (!session?.user) {
      return c.redirect(authenticationRedirect());
    }

    const role = normalizeAppRole((session.user as Record<string, unknown>).role);
    if (role !== "admin" && role !== "owner") {
      return c.redirect(
        settingsRedirect({
          origin: resolveGitProviderCallbackOrigin(),
          key: "git_error",
          value: "admin_required"
        })
      );
    }

    const state = c.req.query("state");
    if (!state || state.length !== 32) {
      return c.redirect(
        settingsRedirect({
          origin: resolveGitProviderCallbackOrigin(),
          key: "git_error",
          value: "invalid_setup_state"
        })
      );
    }

    const callbackOrigin = resolveGitProviderCallbackOrigin();
    const code = c.req.query("code");
    const installationId = c.req.query("installation_id");
    const setupAction = c.req.query("setup_action");

    if (code && installationId && (setupAction === "install" || setupAction === "update")) {
      const setup = await consumeGitProviderSetupState({
        state,
        providerType: "github",
        action: "github_installation",
        callbackOrigin,
        initiatedByUserId: session.user.id
      });
      if (!setup?.providerId) {
        return c.redirect(
          settingsRedirect({
            origin: callbackOrigin,
            key: "git_error",
            value: "invalid_setup_state"
          })
        );
      }
      if (!(await isUserMemberOfTeam(session.user.id, setup.teamId))) {
        return c.redirect(
          settingsRedirect({
            origin: callbackOrigin,
            key: "git_error",
            value: "invalid_setup_state"
          })
        );
      }

      const provider = await getGitProvider(setup.providerId, setup.teamId);
      if (!provider || provider.type !== "github") {
        return c.redirect(
          settingsRedirect({
            origin: callbackOrigin,
            key: "git_error",
            value: "provider_not_found"
          })
        );
      }

      try {
        await verifyGitHubInstallationForUser({ provider, installationId, code });
        const installation = await fetchGitHubInstallationDetails({
          provider,
          installationId
        });
        const result = await createGitInstallation({
          teamId: setup.teamId,
          providerId: provider.id,
          installationId,
          accountName: installation.accountName,
          accountType: installation.accountType,
          repositorySelection: installation.repositorySelection,
          installedByUserId: session.user.id,
          requestedByUserId: session.user.id,
          requestedByEmail: session.user.email,
          requestedByRole: role
        });
        if (result.status === "not_found") {
          return c.redirect(
            settingsRedirect({
              origin: callbackOrigin,
              key: "git_error",
              value: "provider_not_found"
            })
          );
        }

        return c.redirect(
          settingsRedirect({ origin: callbackOrigin, key: "git_setup", value: "installed" })
        );
      } catch (error) {
        console.error("[github-app-setup] Installation verification failed", error);
        return c.redirect(
          settingsRedirect({
            origin: callbackOrigin,
            key: "git_error",
            value: "installation_failed"
          })
        );
      }
    }

    if (code) {
      const setup = await consumeGitProviderSetupState({
        state,
        providerType: "github",
        action: "github_manifest",
        callbackOrigin,
        initiatedByUserId: session.user.id
      });
      if (!setup) {
        return c.redirect(
          settingsRedirect({
            origin: callbackOrigin,
            key: "git_error",
            value: "invalid_setup_state"
          })
        );
      }
      if (!(await isUserMemberOfTeam(session.user.id, setup.teamId))) {
        return c.redirect(
          settingsRedirect({
            origin: callbackOrigin,
            key: "git_error",
            value: "invalid_setup_state"
          })
        );
      }

      try {
        const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "DaoFlow"
          }
        });
        if (!response.ok) {
          return c.redirect(
            settingsRedirect({
              origin: callbackOrigin,
              key: "git_error",
              value: "manifest_conversion_failed"
            })
          );
        }

        const data = (await response.json()) as ManifestConversionResponse;
        if (!data.id || !data.client_id || !data.pem) {
          return c.redirect(
            settingsRedirect({
              origin: callbackOrigin,
              key: "git_error",
              value: "incomplete_manifest_response"
            })
          );
        }

        await registerGitProvider({
          teamId: setup.teamId,
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
          settingsRedirect({
            origin: callbackOrigin,
            key: "git_setup",
            value: "created"
          })
        );
      } catch (error) {
        console.error("[github-app-setup] Manifest conversion failed", error);
        return c.redirect(
          settingsRedirect({
            origin: callbackOrigin,
            key: "git_error",
            value: "manifest_conversion_failed"
          })
        );
      }
    }

    return c.redirect(
      settingsRedirect({ origin: callbackOrigin, key: "git_error", value: "invalid_setup_state" })
    );
  };
}

export const handleGitHubAppSetup = createGitHubAppSetupHandler();
