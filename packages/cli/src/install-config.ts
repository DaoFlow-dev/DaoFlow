import type { Command } from "commander";
import type { CommandActionContext } from "./command-action";
import {
  INITIAL_ADMIN_EMAIL_ENV,
  INITIAL_ADMIN_PASSWORD_ENV,
  resolveInitialAdminCredentials
} from "./install-credentials";
import {
  describeDashboardExposureMode,
  parseDashboardExposureMode,
  readDashboardExposureState,
  type DashboardExposureMode
} from "./install-exposure-state";
import type { ExistingInstallState, InstallerRuntime } from "./installer-lifecycle";
import { parsePort, readExistingInstall } from "./installer-lifecycle";

export interface InstallOptions {
  dir: string;
  domain?: string;
  port: string;
  email?: string;
  password?: string;
  expose?: string;
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
  postgresPassword?: string;
  temporalPostgresPassword?: string;
  existingInstall: ExistingInstallState | null;
  databasePasswordMode: DatabasePasswordMode;
  exposureMode: DashboardExposureMode;
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
  runtime: Pick<InstallerRuntime, "prompt">;
}): Promise<InstallConfigurationResult> {
  const isNonInteractive = input.options.yes ?? false;
  const hasExplicitDomain = input.command.getOptionValueSource("domain") === "cli";
  const hasExplicitPort = input.command.getOptionValueSource("port") === "cli";
  const hasExplicitExpose = input.command.getOptionValueSource("expose") === "cli";

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
  let existingInstall: ExistingInstallState | null = null;
  let databasePasswordMode: DatabasePasswordMode = "auto-generated";
  let postgresPassword: string | undefined;
  let temporalPostgresPassword: string | undefined;

  if (!isNonInteractive) {
    console.error("\n🚀 DaoFlow Installer\n");
    console.error("This will create a production DaoFlow instance on this server.\n");

    dir = await input.runtime.prompt("Install directory", dir);
    existingInstall = readExistingInstall(dir);
    const existingExposure = readDashboardExposureState(dir);

    if (existingInstall) {
      domain = hasExplicitDomain ? domain : (existingInstall.domain ?? domain);
      port = hasExplicitPort ? port : (existingInstall.port ?? port);
      email = email ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_EMAIL?.trim() || undefined);
      password =
        password ?? (existingInstall.env.DAOFLOW_INITIAL_ADMIN_PASSWORD?.trim() || undefined);
      databasePasswordMode = "preserved";
    }

    exposureMode = hasExplicitExpose ? exposureMode : (existingExposure?.mode ?? exposureMode);

    domain = await input.runtime.prompt("Domain name", domain || "localhost");
    const portStr = await input.runtime.prompt("HTTP port", String(port));
    port = parsePort(portStr);
    if (port === null) {
      input.ctx.fail(`Invalid port "${portStr}". Use an integer between 1 and 65535.`, {
        code: "INVALID_PORT"
      });
    }

    exposureMode = requireInstallValue(
      parseDashboardExposureMode(
        await input.runtime.prompt(
          "Dashboard exposure (none/cloudflare-quick/tailscale-serve/tailscale-funnel)",
          exposureMode
        )
      ),
      () =>
        input.ctx.fail("Invalid dashboard exposure mode.", {
          code: "INVALID_EXPOSURE_MODE"
        })
    );

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

    const scheme = resolveInstallScheme(domain, existingInstall);

    console.error();
    console.error("Configuration:");
    console.error(`  Directory:     ${dir}`);
    console.error(`  Domain:        ${domain}`);
    console.error(`  Port:          ${String(port)}`);
    console.error(`  Admin:         ${email}`);
    console.error(`  DB Passwords:  ${databasePasswordMode}`);
    console.error(`  Exposure:      ${describeDashboardExposureMode(exposureMode)}`);
    if (exposureMode !== "none") {
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
      postgresPassword,
      temporalPostgresPassword,
      existingInstall,
      databasePasswordMode,
      exposureMode,
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
    exposureMode = hasExplicitExpose ? exposureMode : (existingExposure?.mode ?? exposureMode);

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
    postgresPassword: existingInstall?.env.POSTGRES_PASSWORD,
    temporalPostgresPassword: existingInstall?.env.TEMPORAL_POSTGRES_PASSWORD,
    existingInstall,
    databasePasswordMode,
    exposureMode,
    exposureRequestedExplicitly: hasExplicitExpose
  };
}
