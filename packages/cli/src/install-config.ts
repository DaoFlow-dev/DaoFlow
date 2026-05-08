import chalk from "chalk";
import { resolveInitialAdminCredentials } from "./install-credentials";
import {
  CLOUDFLARE_TUNNEL_TOKEN_ENV,
  getCloudflareTunnelConfigurationError,
  resolveCloudflareTunnelToken
} from "./install-cloudflare";
import {
  DASHBOARD_EXPOSURE_MODES,
  describeDashboardExposureMode,
  parseDashboardExposureMode,
  readDashboardExposureState,
  type DashboardExposureMode
} from "./install-exposure-state";
import {
  getTraefikConfigurationError,
  isTraefikExposureMode,
  resolveTraefikAcmeEmail
} from "./install-traefik";
import type { ExistingInstallState, SelectChoice } from "./installer-lifecycle";
import { parsePort, readExistingInstall } from "./installer-lifecycle";
import {
  buildInstallOptionSources,
  printInstallSummary,
  requireInstallValue,
  resolveInstallScheme
} from "./install-config-helpers";
import { collectNonInteractiveInstallConfiguration } from "./install-config-noninteractive";
import type {
  CollectInstallConfigurationInput,
  DatabasePasswordMode,
  InstallConfigurationResult
} from "./install-config-types";

export type {
  InstallConfiguration,
  InstallConfigurationResult,
  InstallOptions
} from "./install-config-types";

export async function collectInstallConfiguration(
  input: CollectInstallConfigurationInput
): Promise<InstallConfigurationResult> {
  const isNonInteractive = input.options.yes ?? false;
  const sources = buildInstallOptionSources(input.command);

  let dir = input.options.dir;
  let domain = input.options.domain ?? "localhost";
  let port = parsePort(input.options.port);
  if (port === null) {
    input.ctx.fail(`Invalid port "${input.options.port}". Use an integer between 1 and 65535.`, {
      code: "INVALID_PORT"
    });
  }

  const parsedExposureMode = parseDashboardExposureMode(input.options.expose ?? "none");
  if (!parsedExposureMode) {
    input.ctx.fail(
      `Invalid exposure mode "${input.options.expose}". Use one of: ${[
        "none",
        "traefik",
        "cloudflare-quick",
        "tailscale-serve",
        "tailscale-funnel"
      ].join(", ")}.`,
      { code: "INVALID_EXPOSURE_MODE" }
    );
  }

  let exposureMode = requireInstallValue(parsedExposureMode, () =>
    input.ctx.fail("Invalid exposure mode.", { code: "INVALID_EXPOSURE_MODE" })
  );
  const initialAdmin = resolveInitialAdminCredentials(input.options);
  let email = initialAdmin.email;
  let password = initialAdmin.password;
  let acmeEmail = resolveTraefikAcmeEmail({
    exposureMode,
    acmeEmail: input.options.acmeEmail,
    adminEmail: email
  });
  let existingInstall: ExistingInstallState | null = null;
  let databasePasswordMode: DatabasePasswordMode = "auto-generated";
  let postgresPassword: string | undefined;
  let temporalPostgresPassword: string | undefined;
  let cloudflareTunnelEnabled = Boolean(input.options.cloudflareTunnel);
  let cloudflareTunnelToken = input.options.cloudflareTunnelToken?.trim() || undefined;

  if (!isNonInteractive) {
    console.error("\n🚀 DaoFlow Installer\n");
    console.error("This will create a production DaoFlow instance on this server.\n");

    dir = await input.runtime.prompt("Install directory", dir);
    existingInstall = readExistingInstall(dir);
    const existingExposure = readDashboardExposureState(dir);

    if (existingInstall) {
      domain = sources.hasExplicitDomain ? domain : (existingInstall.domain ?? domain);
      port = sources.hasExplicitPort ? port : (existingInstall.port ?? port);
      email = email ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_EMAIL?.trim() || undefined);
      password =
        password ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_PASSWORD?.trim() || undefined);
      acmeEmail = acmeEmail ?? (existingInstall.env.DAOFLOW_ACME_EMAIL?.trim() || undefined);
      databasePasswordMode = "preserved";
      cloudflareTunnelEnabled =
        sources.hasExplicitCloudflareTunnel || sources.hasExplicitCloudflareTunnelToken
          ? cloudflareTunnelEnabled || Boolean(cloudflareTunnelToken)
          : Boolean(existingInstall.env[CLOUDFLARE_TUNNEL_TOKEN_ENV]?.trim());
      cloudflareTunnelToken =
        cloudflareTunnelToken ??
        existingInstall.env[CLOUDFLARE_TUNNEL_TOKEN_ENV]?.trim() ??
        undefined;
    }

    exposureMode = sources.hasExplicitExpose
      ? exposureMode
      : (existingExposure?.mode ?? exposureMode);

    const exposureChoices: SelectChoice<DashboardExposureMode>[] = DASHBOARD_EXPOSURE_MODES.map(
      (mode) => ({ label: describeDashboardExposureMode(mode), value: mode })
    );
    exposureMode = await input.runtime.promptSelect(
      "Dashboard exposure",
      exposureChoices,
      exposureMode
    );

    const cloudflareTunnelAnswer = await input.runtime.prompt(
      "Enable Cloudflare Tunnel sidecar? (y/N)",
      cloudflareTunnelEnabled ? "y" : "n"
    );
    cloudflareTunnelEnabled = cloudflareTunnelAnswer.trim().toLowerCase() === "y";
    if (cloudflareTunnelEnabled) {
      cloudflareTunnelToken = await input.runtime.prompt(
        "Cloudflare tunnel token",
        cloudflareTunnelToken
      );
    } else {
      cloudflareTunnelToken = undefined;
    }

    const requiresPublicDomain =
      isTraefikExposureMode(exposureMode) || exposureMode === "tailscale-funnel";
    const wantsDomain = requiresPublicDomain || cloudflareTunnelEnabled;

    if (wantsDomain) {
      const defaultDomain = domain && domain !== "localhost" ? domain : "";
      while (true) {
        domain = await input.runtime.prompt(
          "Domain name (e.g. deploy.example.com)",
          defaultDomain || undefined
        );
        const hostname = domain.trim().toLowerCase();
        if (hostname && hostname !== "localhost" && hostname.includes(".")) {
          break;
        }
        console.error(
          chalk.yellow(
            "  A valid public domain is required for this exposure mode. Please try again."
          )
        );
      }
    } else {
      domain = await input.runtime.prompt("Domain name", domain || "localhost");
    }

    const portStr = await input.runtime.prompt("Local dashboard port", String(port));
    port = parsePort(portStr);
    if (port === null) {
      input.ctx.fail(`Invalid port "${portStr}". Use an integer between 1 and 65535.`, {
        code: "INVALID_PORT"
      });
    }

    email = await input.runtime.prompt("Admin email", email);
    if (password) {
      console.error("Admin password already provided via flag or environment.");
    } else {
      password = await input.runtime.prompt("Admin password");
    }

    if (!email || !password) {
      input.ctx.fail("Email and password are required for the admin account.");
    }

    if (password.length < 8) {
      input.ctx.fail("Admin password must be at least 8 characters.");
    }

    if (exposureMode === "traefik" && !sources.hasExplicitAcmeEmail) {
      acmeEmail = await input.runtime.prompt("Let's Encrypt email", acmeEmail ?? email);
    }

    acmeEmail = resolveTraefikAcmeEmail({
      exposureMode,
      acmeEmail: sources.hasExplicitAcmeEmail ? input.options.acmeEmail : acmeEmail,
      adminEmail: email,
      existingEnv: existingInstall?.env
    });
    cloudflareTunnelToken = resolveCloudflareTunnelToken({
      enabled: cloudflareTunnelEnabled,
      token: sources.hasExplicitCloudflareTunnelToken
        ? input.options.cloudflareTunnelToken
        : cloudflareTunnelToken,
      existingEnv: existingInstall?.env
    });

    if (existingInstall) {
      console.error(`\nExisting DaoFlow installation found (v${existingInstall.version}).`);
      console.error(
        "Current secrets and settings will be preserved unless you explicitly override them."
      );
    } else {
      const pwChoice = await input.runtime.prompt(
        "Database passwords - auto-generate or enter manually? (auto/manual)",
        "auto"
      );

      if (pwChoice.toLowerCase() === "manual") {
        postgresPassword = await input.runtime.prompt("Postgres password (daoflow DB)");
        temporalPostgresPassword = await input.runtime.prompt("Postgres password (temporal DB)");
        if (!postgresPassword || !temporalPostgresPassword) {
          input.ctx.fail("Both database passwords are required.");
        }
        databasePasswordMode = "manual";
      } else {
        console.error("  Secure passwords will be auto-generated.");
      }
    }

    const traefikError = getTraefikConfigurationError({
      exposureMode,
      domain,
      port,
      acmeEmail
    });
    if (traefikError) {
      input.ctx.fail(traefikError, {
        code: "INVALID_EXPOSURE_CONFIGURATION"
      });
    }

    const cloudflareError = getCloudflareTunnelConfigurationError({
      enabled: cloudflareTunnelEnabled,
      token: cloudflareTunnelToken
    });
    if (cloudflareError) {
      input.ctx.fail(cloudflareError, {
        code: "INVALID_CLOUDFLARE_TUNNEL_CONFIGURATION"
      });
    }

    const scheme = resolveInstallScheme(domain, existingInstall);

    printInstallSummary({
      dir,
      domain,
      port,
      email,
      databasePasswordMode,
      exposureMode,
      cloudflareTunnelEnabled,
      acmeEmail
    });

    const confirm = await input.runtime.prompt("Proceed? (y/N)", "y");
    if (confirm.toLowerCase() !== "y") {
      return { cancelled: true };
    }

    return {
      cancelled: false,
      dir,
      domain,
      port: requireInstallValue(port, () =>
        input.ctx.fail("Install port is required.", { code: "INVALID_PORT" })
      ),
      scheme,
      email,
      password,
      acmeEmail,
      postgresPassword,
      temporalPostgresPassword,
      existingInstall,
      databasePasswordMode,
      exposureMode,
      cloudflareTunnelEnabled,
      cloudflareTunnelToken,
      exposureRequestedExplicitly: sources.hasExplicitExpose
    };
  }

  return collectNonInteractiveInstallConfiguration({
    options: input.options,
    ctx: input.ctx,
    sources,
    parsedPort: port,
    exposureMode
  });
}
