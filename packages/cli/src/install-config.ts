import type { Command } from "commander";
import chalk from "chalk";
import type { CommandActionContext } from "./command-action";
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
import type { ExistingInstallState, InstallerRuntime, SelectChoice } from "./installer-lifecycle";
import { parsePort, readExistingInstall } from "./installer-lifecycle";

export interface InstallOptions {
  dir: string;
  domain?: string;
  port: string;
  acmeEmail?: string;
  email?: string;
  password?: string;
  expose?: string;
  cloudflareTunnel?: boolean;
  cloudflareTunnelToken?: string;
  yes?: boolean;
  json?: boolean;
}

type DatabasePasswordMode = "auto-generated" | "manual" | "preserved";

export interface InstallConfiguration {
  dir: string;
  domain: string;
  port: number;
  scheme: "http" | "https";
  email: string;
  password: string;
  acmeEmail?: string;
  postgresPassword?: string;
  temporalPostgresPassword?: string;
  existingInstall: ExistingInstallState | null;
  databasePasswordMode: DatabasePasswordMode;
  exposureMode: DashboardExposureMode;
  cloudflareTunnelEnabled: boolean;
  cloudflareTunnelToken?: string;
  exposureRequestedExplicitly: boolean;
}

export type InstallConfigurationResult =
  | ({ cancelled: true } & Partial<InstallConfiguration>)
  | ({ cancelled: false } & InstallConfiguration);

function resolveInstallScheme(
  domain: string,
  existingInstall: ExistingInstallState | null
): "http" | "https" {
  if (existingInstall?.scheme) {
    return existingInstall.scheme;
  }

  return domain === "localhost" ? "http" : "https";
}

function requireInstallValue<T>(
  value: T | null | undefined,
  onMissing: () => never
): Exclude<T, null | undefined> {
  if (value === null || value === undefined) {
    return onMissing();
  }

  return value as Exclude<T, null | undefined>;
}

export async function collectInstallConfiguration(input: {
  options: InstallOptions;
  command: Command;
  ctx: CommandActionContext;
  runtime: Pick<InstallerRuntime, "prompt" | "promptSelect">;
}): Promise<InstallConfigurationResult> {
  const isNonInteractive = input.options.yes ?? false;
  const hasExplicitDomain = input.command.getOptionValueSource("domain") === "cli";
  const hasExplicitPort = input.command.getOptionValueSource("port") === "cli";
  const hasExplicitExpose = input.command.getOptionValueSource("expose") === "cli";
  const hasExplicitAcmeEmail = input.command.getOptionValueSource("acmeEmail") === "cli";
  const hasExplicitCloudflareTunnel =
    input.command.getOptionValueSource("cloudflareTunnel") === "cli";
  const hasExplicitCloudflareTunnelToken =
    input.command.getOptionValueSource("cloudflareTunnelToken") === "cli";

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

    // --- Step 1: Install directory ---
    dir = await input.runtime.prompt("Install directory", dir);
    existingInstall = readExistingInstall(dir);
    const existingExposure = readDashboardExposureState(dir);

    if (existingInstall) {
      domain = hasExplicitDomain ? domain : (existingInstall.domain ?? domain);
      port = hasExplicitPort ? port : (existingInstall.port ?? port);
      email = email ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_EMAIL?.trim() || undefined);
      password =
        password ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_PASSWORD?.trim() || undefined);
      acmeEmail = acmeEmail ?? (existingInstall.env.DAOFLOW_ACME_EMAIL?.trim() || undefined);
      databasePasswordMode = "preserved";
      cloudflareTunnelEnabled =
        hasExplicitCloudflareTunnel || hasExplicitCloudflareTunnelToken
          ? cloudflareTunnelEnabled || Boolean(cloudflareTunnelToken)
          : Boolean(existingInstall.env[CLOUDFLARE_TUNNEL_TOKEN_ENV]?.trim());
      cloudflareTunnelToken =
        cloudflareTunnelToken ??
        existingInstall.env[CLOUDFLARE_TUNNEL_TOKEN_ENV]?.trim() ??
        undefined;
    }

    exposureMode = hasExplicitExpose ? exposureMode : (existingExposure?.mode ?? exposureMode);

    // --- Step 2: Dashboard exposure (numbered selector) ---
    const exposureChoices: SelectChoice<DashboardExposureMode>[] = DASHBOARD_EXPOSURE_MODES.map(
      (mode) => ({ label: describeDashboardExposureMode(mode), value: mode })
    );
    exposureMode = await input.runtime.promptSelect(
      "Dashboard exposure",
      exposureChoices,
      exposureMode
    );

    // --- Step 3: Cloudflare Tunnel sidecar ---
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

    // --- Step 4: Domain name (conditional, with re-prompt loop) ---
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

    // --- Step 5: Local dashboard port ---
    const portStr = await input.runtime.prompt("Local dashboard port", String(port));
    port = parsePort(portStr);
    if (port === null) {
      input.ctx.fail(`Invalid port "${portStr}". Use an integer between 1 and 65535.`, {
        code: "INVALID_PORT"
      });
    }

    // --- Step 6: Admin credentials ---
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

    // --- Step 7: Let's Encrypt email (traefik only) ---
    if (exposureMode === "traefik" && !hasExplicitAcmeEmail) {
      acmeEmail = await input.runtime.prompt("Let's Encrypt email", acmeEmail ?? email);
    }

    acmeEmail = resolveTraefikAcmeEmail({
      exposureMode,
      acmeEmail: hasExplicitAcmeEmail ? input.options.acmeEmail : acmeEmail,
      adminEmail: email,
      existingEnv: existingInstall?.env
    });
    cloudflareTunnelToken = resolveCloudflareTunnelToken({
      enabled: cloudflareTunnelEnabled,
      token: hasExplicitCloudflareTunnelToken
        ? input.options.cloudflareTunnelToken
        : cloudflareTunnelToken,
      existingEnv: existingInstall?.env
    });

    // --- Step 8: Database passwords ---
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

    // --- Validate exposure configuration ---
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

    console.error();
    console.error("Configuration:");
    console.error(`  Directory:     ${dir}`);
    console.error(`  Domain:        ${domain}`);
    console.error(`  Port:          ${String(port)}`);
    console.error(`  Admin:         ${email}`);
    console.error(`  DB Passwords:  ${databasePasswordMode}`);
    console.error(`  Exposure:      ${describeDashboardExposureMode(exposureMode)}`);
    console.error(`  CF Tunnel:     ${cloudflareTunnelEnabled ? "enabled" : "disabled"}`);
    if (acmeEmail) {
      console.error(`  ACME Email:    ${acmeEmail}`);
    }
    if (cloudflareTunnelEnabled) {
      console.error(`  CF Token:      ${CLOUDFLARE_TUNNEL_TOKEN_ENV}`);
    }
    if (exposureMode !== "none" || cloudflareTunnelEnabled) {
      console.error(
        "  Note: BETTER_AUTH_URL will be updated to the exposed HTTPS URL if setup succeeds."
      );
    }
    console.error();

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
      exposureRequestedExplicitly: hasExplicitExpose
    };
  }

  existingInstall = readExistingInstall(dir);
  const existingExposure = readDashboardExposureState(dir);

  if (existingInstall) {
    domain = hasExplicitDomain ? domain : (existingInstall.domain ?? domain);
    port = hasExplicitPort ? port : (existingInstall.port ?? port);
    email = email ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_EMAIL?.trim() || undefined);
    password =
      password ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_PASSWORD?.trim() || undefined);
    acmeEmail = acmeEmail ?? (existingInstall.env.DAOFLOW_ACME_EMAIL?.trim() || undefined);
    exposureMode = hasExplicitExpose ? exposureMode : (existingExposure?.mode ?? exposureMode);
    cloudflareTunnelEnabled =
      hasExplicitCloudflareTunnel || hasExplicitCloudflareTunnelToken
        ? cloudflareTunnelEnabled || Boolean(cloudflareTunnelToken)
        : Boolean(existingInstall.env[CLOUDFLARE_TUNNEL_TOKEN_ENV]?.trim());
    cloudflareTunnelToken =
      cloudflareTunnelToken ??
      existingInstall.env[CLOUDFLARE_TUNNEL_TOKEN_ENV]?.trim() ??
      undefined;

    if (!input.ctx.isJson) {
      console.error(
        `Existing DaoFlow installation found (v${existingInstall.version}); preserving current secrets and settings unless explicitly overridden.`
      );
    }
  }

  if (!email) {
    input.ctx.fail(`Admin email is required (--email or ${INITIAL_ADMIN_EMAIL_ENV})`, {
      code: "MISSING_EMAIL"
    });
  }
  if (!password) {
    input.ctx.fail(`Admin password is required (--password or ${INITIAL_ADMIN_PASSWORD_ENV})`, {
      code: "MISSING_PASSWORD"
    });
  }

  const ensuredPassword = requireInstallValue(password, () =>
    input.ctx.fail(`Admin password is required (--password or ${INITIAL_ADMIN_PASSWORD_ENV})`, {
      code: "MISSING_PASSWORD"
    })
  );
  if (ensuredPassword.length < 8) {
    input.ctx.fail("Admin password must be at least 8 characters", {
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
      input.ctx.fail(`Invalid port "${input.options.port}". Use an integer between 1 and 65535.`, {
        code: "INVALID_PORT"
      })
    ),
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

  return {
    cancelled: false,
    dir,
    domain,
    port: requireInstallValue(port, () =>
      input.ctx.fail(`Invalid port "${input.options.port}". Use an integer between 1 and 65535.`, {
        code: "INVALID_PORT"
      })
    ),
    scheme: resolveInstallScheme(domain, existingInstall),
    email: requireInstallValue(email, () =>
      input.ctx.fail("Admin email is required for installation.", {
        code: "MISSING_EMAIL"
      })
    ),
    password: ensuredPassword,
    acmeEmail,
    postgresPassword: existingInstall?.env.POSTGRES_PASSWORD,
    temporalPostgresPassword: existingInstall?.env.TEMPORAL_POSTGRES_PASSWORD,
    existingInstall,
    databasePasswordMode,
    exposureMode,
    cloudflareTunnelEnabled,
    cloudflareTunnelToken,
    exposureRequestedExplicitly: hasExplicitExpose
  };
}
