import {
  INITIAL_ADMIN_EMAIL_ENV,
  INITIAL_ADMIN_PASSWORD_ENV,
  resolveInitialAdminCredentials
} from "./install-credentials";
import {
  CLOUDFLARE_TUNNEL_TOKEN_ENV,
  getCloudflareTunnelConfigurationError,
  resolveCloudflareTunnelToken
} from "./install-cloudflare";
import { readDashboardExposureState, type DashboardExposureMode } from "./install-exposure-state";
import { getTraefikConfigurationError, resolveTraefikAcmeEmail } from "./install-traefik";
import type {
  InstallConfigurationResult,
  InstallOptionSources,
  InstallOptions
} from "./install-config-types";
import { requireInstallValue, resolveInstallScheme } from "./install-config-helpers";
import type { CommandActionContext } from "./command-action";
import { readExistingInstall } from "./installer-lifecycle";
import type { InstallWorkflowProfile } from "./install-workflow-profile";

export function collectNonInteractiveInstallConfiguration(input: {
  options: InstallOptions;
  ctx: CommandActionContext;
  sources: InstallOptionSources;
  parsedPort: number | null;
  exposureMode: DashboardExposureMode;
  requestedWorkflowProfile: InstallWorkflowProfile;
}): InstallConfigurationResult {
  const { options, ctx, sources } = input;
  let domain = options.domain ?? "localhost";
  let port = input.parsedPort;
  const initialAdmin = resolveInitialAdminCredentials(options);
  let email = initialAdmin.email;
  let password = initialAdmin.password;
  let acmeEmail = resolveTraefikAcmeEmail({
    exposureMode: input.exposureMode,
    acmeEmail: options.acmeEmail,
    adminEmail: email
  });
  let exposureMode = input.exposureMode;
  const existingInstall = readExistingInstall(options.dir);
  let cloudflareTunnelEnabled = Boolean(options.cloudflareTunnel);
  let cloudflareTunnelToken = options.cloudflareTunnelToken?.trim() || undefined;
  let workflowProfile = input.requestedWorkflowProfile;

  if (existingInstall) {
    domain = sources.hasExplicitDomain ? domain : (existingInstall.domain ?? domain);
    port = sources.hasExplicitPort ? port : (existingInstall.port ?? port);
    email = email ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_EMAIL?.trim() || undefined);
    password =
      password ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_PASSWORD?.trim() || undefined);
    acmeEmail = acmeEmail ?? (existingInstall.env.DAOFLOW_ACME_EMAIL?.trim() || undefined);
    exposureMode = sources.hasExplicitExpose
      ? exposureMode
      : (readDashboardExposureState(options.dir)?.mode ?? exposureMode);
    cloudflareTunnelEnabled =
      sources.hasExplicitCloudflareTunnel || sources.hasExplicitCloudflareTunnelToken
        ? cloudflareTunnelEnabled || Boolean(cloudflareTunnelToken)
        : Boolean(existingInstall.env[CLOUDFLARE_TUNNEL_TOKEN_ENV]?.trim());
    cloudflareTunnelToken =
      cloudflareTunnelToken ??
      existingInstall.env[CLOUDFLARE_TUNNEL_TOKEN_ENV]?.trim() ??
      undefined;
    workflowProfile = sources.hasExplicitWorkflowProfile
      ? workflowProfile
      : existingInstall.workflowProfile;

    if (!ctx.isJson) {
      console.error(
        `Existing DaoFlow installation found (v${existingInstall.version}); preserving current secrets and settings unless explicitly overridden.`
      );
    }
  }

  if (!email) {
    ctx.fail(`Admin email is required (--email or ${INITIAL_ADMIN_EMAIL_ENV})`, {
      code: "MISSING_EMAIL"
    });
  }
  if (!password) {
    ctx.fail(`Admin password is required (--password or ${INITIAL_ADMIN_PASSWORD_ENV})`, {
      code: "MISSING_PASSWORD"
    });
  }

  const ensuredPassword = requireInstallValue(password, () =>
    ctx.fail(`Admin password is required (--password or ${INITIAL_ADMIN_PASSWORD_ENV})`, {
      code: "MISSING_PASSWORD"
    })
  );
  if (ensuredPassword.length < 8) {
    ctx.fail("Admin password must be at least 8 characters", {
      code: "PASSWORD_TOO_SHORT"
    });
  }

  acmeEmail = resolveTraefikAcmeEmail({
    exposureMode,
    acmeEmail,
    adminEmail: email,
    existingEnv: existingInstall?.env
  });
  cloudflareTunnelEnabled = cloudflareTunnelEnabled || Boolean(cloudflareTunnelToken?.trim());
  cloudflareTunnelToken = resolveCloudflareTunnelToken({
    enabled: cloudflareTunnelEnabled,
    token: cloudflareTunnelToken,
    existingEnv: existingInstall?.env
  });

  const traefikError = getTraefikConfigurationError({
    exposureMode,
    domain,
    port: requireInstallValue(port, () =>
      ctx.fail(`Invalid port "${options.port}". Use an integer between 1 and 65535.`, {
        code: "INVALID_PORT"
      })
    ),
    acmeEmail
  });
  if (traefikError) {
    ctx.fail(traefikError, {
      code: "INVALID_EXPOSURE_CONFIGURATION"
    });
  }

  const cloudflareError = getCloudflareTunnelConfigurationError({
    enabled: cloudflareTunnelEnabled,
    token: cloudflareTunnelToken
  });
  if (cloudflareError) {
    ctx.fail(cloudflareError, {
      code: "INVALID_CLOUDFLARE_TUNNEL_CONFIGURATION"
    });
  }

  return {
    cancelled: false,
    dir: options.dir,
    domain,
    port: requireInstallValue(port, () =>
      ctx.fail(`Invalid port "${options.port}". Use an integer between 1 and 65535.`, {
        code: "INVALID_PORT"
      })
    ),
    scheme: resolveInstallScheme(domain, existingInstall),
    email: requireInstallValue(email, () =>
      ctx.fail("Admin email is required for installation.", {
        code: "MISSING_EMAIL"
      })
    ),
    password: ensuredPassword,
    acmeEmail,
    postgresPassword: existingInstall?.env.POSTGRES_PASSWORD,
    temporalPostgresPassword: existingInstall?.env.TEMPORAL_POSTGRES_PASSWORD,
    workflowProfile,
    existingInstall,
    databasePasswordMode: "auto-generated",
    exposureMode,
    cloudflareTunnelEnabled,
    cloudflareTunnelToken,
    exposureRequestedExplicitly: sources.hasExplicitExpose
  };
}
