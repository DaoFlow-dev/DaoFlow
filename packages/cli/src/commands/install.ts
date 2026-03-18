import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createInterface } from "readline";
import chalk from "chalk";
import ora from "ora";
import { getErrorMessage, getExecErrorMessage, resolveCommandJsonOption } from "../command-helpers";
import { fetchComposeYml, generateEnvFile, defaultInstallDir, parseEnvFile } from "../templates";
import { CLI_VERSION } from "../version";
const INITIAL_ADMIN_EMAIL_ENV = "DAOFLOW_INITIAL_ADMIN_EMAIL";
const INITIAL_ADMIN_PASSWORD_ENV = "DAOFLOW_INITIAL_ADMIN_PASSWORD";

interface InstallOptions {
  dir: string;
  domain?: string;
  port: string;
  email?: string;
  password?: string;
  yes?: boolean;
  json?: boolean;
  _pgPassword?: string;
  _temporalPgPassword?: string;
}

type InitialAdminCredentialSource = "none" | "flags" | "env" | "mixed";

interface ExistingInstallState {
  env: Record<string, string>;
  version: string;
  domain?: string;
  port?: number;
  scheme?: "http" | "https";
}

/**
 * Prompt the user for input (interactive mode).
 */
function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

/**
 * Check if Docker is available.
 */
function checkDocker(): { available: boolean; compose: boolean; version?: string } {
  try {
    const version = execSync("docker --version", { encoding: "utf-8" }).trim();
    let compose = false;
    try {
      execSync("docker compose version", { encoding: "utf-8", stdio: "pipe" });
      compose = true;
    } catch {
      // docker compose not available
    }
    return { available: true, compose, version };
  } catch {
    return { available: false, compose: false };
  }
}

interface InstallRuntime {
  checkDocker(this: void): { available: boolean; compose: boolean; version?: string };
  exec(this: void, command: string, options?: Parameters<typeof execSync>[1]): string | Buffer;
  fetch(this: void, url: string): Promise<Response>;
  fetchComposeYml(this: void): Promise<string>;
  prompt(this: void, question: string, defaultValue?: string): Promise<string>;
  sleep(this: void, ms: number): Promise<void>;
}

export const installRuntime: InstallRuntime = {
  checkDocker,
  exec: (command, options) => execSync(command, options),
  fetch: (url) => globalThis.fetch(url),
  fetchComposeYml,
  prompt,
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    })
};

function emitInstallError(isJson: boolean, error: string, code: string): void {
  if (isJson) {
    console.log(JSON.stringify({ ok: false, error, code }));
  } else {
    console.error(chalk.red(error));
  }
}

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return port;
}

function readExistingInstall(dir: string): ExistingInstallState | null {
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) {
    return null;
  }

  const env = parseEnvFile(readFileSync(envPath, "utf-8"));
  const existingUrl = env.BETTER_AUTH_URL?.trim();
  let domain: string | undefined;
  let port: number | undefined;
  let scheme: "http" | "https" | undefined;

  if (existingUrl) {
    try {
      const parsedUrl = new URL(existingUrl);
      domain = parsedUrl.hostname;
      scheme = parsedUrl.protocol === "http:" ? "http" : "https";
      port =
        parsePort(parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80")) ?? undefined;
    } catch {
      domain = undefined;
      port = parsePort(env.DAOFLOW_PORT ?? "") ?? undefined;
    }
  } else {
    port = parsePort(env.DAOFLOW_PORT ?? "") ?? undefined;
  }

  return {
    env,
    version: env.DAOFLOW_VERSION || "unknown",
    domain,
    port,
    scheme
  };
}

export function resolveInitialAdminCredentials(
  options: Pick<InstallOptions, "email" | "password">,
  env: NodeJS.ProcessEnv = process.env
): {
  email: string | undefined;
  password: string | undefined;
  source: InitialAdminCredentialSource;
} {
  const optionEmail = options.email?.trim() || undefined;
  const optionPassword = options.password?.trim() || undefined;
  const envEmail = env[INITIAL_ADMIN_EMAIL_ENV]?.trim() || undefined;
  const envPassword = env[INITIAL_ADMIN_PASSWORD_ENV]?.trim() || undefined;
  const emailFromEnv = !optionEmail && !!envEmail;
  const passwordFromEnv = !optionPassword && !!envPassword;

  let source: InitialAdminCredentialSource = "none";
  if (optionEmail || optionPassword) {
    source = emailFromEnv || passwordFromEnv ? "mixed" : "flags";
  } else if (envEmail || envPassword) {
    source = "env";
  }

  return {
    email: optionEmail ?? envEmail,
    password: optionPassword ?? envPassword,
    source
  };
}

export function installCommand(): Command {
  return new Command("install")
    .description(
      "Install DaoFlow on this server — creates a docker-compose project with auto-generated secrets"
    )
    .option("--dir <path>", "Installation directory", defaultInstallDir())
    .option("--domain <hostname>", "Public domain (e.g., deploy.example.com)")
    .option("--port <number>", "HTTP port", "3000")
    .option(
      "--email <email>",
      `Admin email for first user (defaults to ${INITIAL_ADMIN_EMAIL_ENV})`
    )
    .option(
      "--password <password>",
      `Admin password for first user (defaults to ${INITIAL_ADMIN_PASSWORD_ENV})`
    )
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Output as structured JSON")
    .action(async (opts: InstallOptions, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const isNonInteractive = opts.yes ?? false;
      const hasExplicitDomain = command.getOptionValueSource("domain") === "cli";
      const hasExplicitPort = command.getOptionValueSource("port") === "cli";

      // -- Step 1: Check Docker --
      const spinner = !isJson ? ora("Checking Docker...").start() : null;
      const docker = installRuntime.checkDocker();

      if (!docker.available) {
        spinner?.fail("Docker is not installed");
        if (isJson) {
          console.log(
            JSON.stringify({
              ok: false,
              error:
                "Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/",
              code: "DOCKER_NOT_FOUND"
            })
          );
        } else {
          console.error(chalk.red("\nDocker is required. Install it first:"));
          console.error(chalk.dim("  https://docs.docker.com/engine/install/"));
          console.error(chalk.dim("  Or: curl -fsSL https://get.docker.com | sh"));
        }
        process.exit(1);
      }

      if (!docker.compose) {
        spinner?.fail("Docker Compose v2 is required");
        if (isJson) {
          console.log(
            JSON.stringify({
              ok: false,
              error: "Docker Compose v2 not found",
              code: "COMPOSE_NOT_FOUND"
            })
          );
        }
        process.exit(1);
      }

      spinner?.succeed(`Docker found: ${docker.version}`);

      // -- Step 2: Gather config --
      let dir = opts.dir;
      let domain = opts.domain ?? "localhost";
      let port = parsePort(opts.port);
      let scheme: "http" | "https" = domain === "localhost" ? "http" : "https";
      if (port === null) {
        emitInstallError(
          isJson,
          `Invalid port "${opts.port}". Use an integer between 1 and 65535.`,
          "INVALID_PORT"
        );
        process.exit(1);
      }
      const initialAdmin = resolveInitialAdminCredentials(opts);
      let email = initialAdmin.email;
      let password = initialAdmin.password;
      let existingInstall: ExistingInstallState | null = null;
      let databasePasswordMode = "auto-generated";

      if (!isNonInteractive) {
        console.error(chalk.bold("\n🚀 DaoFlow Installer\n"));
        console.error(
          chalk.dim("This will create a production DaoFlow instance on this server.\n")
        );

        dir = await installRuntime.prompt("Install directory", dir);
        existingInstall = readExistingInstall(dir);

        if (existingInstall) {
          domain = hasExplicitDomain ? domain : (existingInstall.domain ?? domain);
          port = hasExplicitPort ? port : (existingInstall.port ?? port);
          scheme = existingInstall.scheme ?? scheme;
          const existingEmail =
            existingInstall.env.DAOFLOW_INITIAL_ADMIN_EMAIL?.trim() || undefined;
          const existingPassword =
            existingInstall.env.DAOFLOW_INITIAL_ADMIN_PASSWORD?.trim() || undefined;
          email = email ?? existingEmail;
          password = password ?? existingPassword;
          databasePasswordMode = "preserved";
        }

        domain = await installRuntime.prompt("Domain name", domain || "localhost");
        const portStr = await installRuntime.prompt("HTTP port", String(port));
        port = parsePort(portStr);
        if (port === null) {
          emitInstallError(
            isJson,
            `Invalid port "${portStr}". Use an integer between 1 and 65535.`,
            "INVALID_PORT"
          );
          process.exit(1);
        }
        email = await installRuntime.prompt("Admin email", email);
        if (password) {
          console.error(chalk.dim("Admin password already provided via flag or environment."));
        } else {
          password = await installRuntime.prompt("Admin password");
        }

        if (!email || !password) {
          console.error(chalk.red("Email and password are required for the admin account."));
          process.exit(1);
        }

        if (password.length < 8) {
          console.error(chalk.red("Admin password must be at least 8 characters."));
          process.exit(1);
        }

        if (existingInstall) {
          console.error(
            chalk.yellow(`\nExisting DaoFlow installation found (v${existingInstall.version}).`)
          );
          console.error(
            chalk.dim(
              "Current secrets and settings will be preserved unless you explicitly override them."
            )
          );
        } else {
          // Password generation choice
          const pwChoice = await installRuntime.prompt(
            "Database passwords — auto-generate or enter manually? (auto/manual)",
            "auto"
          );

          let pgPassword: string | undefined;
          let temporalPgPassword: string | undefined;

          if (pwChoice.toLowerCase() === "manual") {
            pgPassword = await installRuntime.prompt("Postgres password (daoflow DB)");
            temporalPgPassword = await installRuntime.prompt("Postgres password (temporal DB)");
            if (!pgPassword || !temporalPgPassword) {
              console.error(chalk.red("Both database passwords are required."));
              process.exit(1);
            }
            databasePasswordMode = "manual";
          } else {
            console.error(chalk.dim("  Secure passwords will be auto-generated."));
          }

          // Store for later use in generateEnvFile
          opts._pgPassword = pgPassword;
          opts._temporalPgPassword = temporalPgPassword;
        }

        console.error();
        console.error(chalk.bold("Configuration:"));
        console.error(`  Directory:     ${chalk.cyan(dir)}`);
        console.error(`  Domain:        ${chalk.cyan(domain)}`);
        console.error(`  Port:          ${chalk.cyan(String(port))}`);
        console.error(`  Admin:         ${chalk.cyan(email)}`);
        console.error(`  DB Passwords:  ${chalk.cyan(databasePasswordMode)}`);
        console.error();

        const confirm = await installRuntime.prompt("Proceed? (y/N)", "y");
        if (confirm.toLowerCase() !== "y") {
          console.error(chalk.yellow("Cancelled."));
          process.exit(0);
        }
      } else {
        existingInstall = readExistingInstall(dir);
        if (existingInstall) {
          domain = hasExplicitDomain ? domain : (existingInstall.domain ?? domain);
          port = hasExplicitPort ? port : (existingInstall.port ?? port);
          scheme = existingInstall.scheme ?? scheme;
          const existingEmail =
            existingInstall.env.DAOFLOW_INITIAL_ADMIN_EMAIL?.trim() || undefined;
          const existingPassword =
            existingInstall.env.DAOFLOW_INITIAL_ADMIN_PASSWORD?.trim() || undefined;
          email = email ?? existingEmail;
          password = password ?? existingPassword;
          if (!isJson) {
            console.error(
              chalk.yellow(
                `Existing DaoFlow installation found (v${existingInstall.version}); preserving current secrets and settings unless explicitly overridden.`
              )
            );
          }
        }

        // Non-interactive validation
        if (!email) {
          const msg = `Admin email is required (--email or ${INITIAL_ADMIN_EMAIL_ENV})`;
          emitInstallError(isJson, msg, "MISSING_EMAIL");
          process.exit(1);
        }
        if (!password) {
          const msg = `Admin password is required (--password or ${INITIAL_ADMIN_PASSWORD_ENV})`;
          emitInstallError(isJson, msg, "MISSING_PASSWORD");
          process.exit(1);
        }
        if (password.length < 8) {
          emitInstallError(
            isJson,
            "Admin password must be at least 8 characters",
            "PASSWORD_TOO_SHORT"
          );
          process.exit(1);
        }
      }

      // -- Step 3: Check for existing install --
      const envPath = join(dir, ".env");
      const composePath = join(dir, "docker-compose.yml");

      // -- Step 4: Create directory --
      const dirSpinner = !isJson ? ora("Creating installation directory...").start() : null;
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(dir, "backups"), { recursive: true });
      dirSpinner?.succeed(`Directory: ${dir}`);

      // -- Step 5: Generate .env --
      const envSpinner = !isJson ? ora("Generating secrets and configuration...").start() : null;
      const envContent = generateEnvFile({
        version: CLI_VERSION,
        domain,
        port,
        scheme,
        initialAdminEmail: email,
        initialAdminPassword: password,
        postgresPassword: opts._pgPassword ?? existingInstall?.env.POSTGRES_PASSWORD,
        temporalPostgresPassword:
          opts._temporalPgPassword ?? existingInstall?.env.TEMPORAL_POSTGRES_PASSWORD,
        authSecret: existingInstall?.env.BETTER_AUTH_SECRET,
        encryptionKey: existingInstall?.env.ENCRYPTION_KEY,
        preservedEnv: existingInstall?.env
      });
      writeFileSync(envPath, envContent, { mode: 0o600 });
      envSpinner?.succeed("Secrets generated and saved to .env");

      // -- Step 6: Fetch docker-compose.yml --
      const composeSpinner = !isJson ? ora("Fetching docker-compose.yml...").start() : null;
      try {
        const composeContent = await installRuntime.fetchComposeYml();
        writeFileSync(composePath, composeContent);
        composeSpinner?.succeed("docker-compose.yml written");
      } catch (error) {
        composeSpinner?.fail("Failed to fetch docker-compose.yml");
        const message = getErrorMessage(error);
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: message, code: "COMPOSE_FETCH_FAILED" }));
        } else {
          console.error(chalk.red(message));
        }
        process.exit(1);
      }

      // -- Step 7: Pull images --
      const pullSpinner = !isJson
        ? ora("Pulling Docker images (this may take a minute)...").start()
        : null;
      try {
        installRuntime.exec("docker compose pull", {
          cwd: dir,
          stdio: "pipe",
          env: { ...process.env, ...parseEnvFile(readFileSync(envPath, "utf-8")) }
        });
        pullSpinner?.succeed("Docker images pulled");
      } catch {
        pullSpinner?.warn("Image pull failed — will attempt to start anyway");
      }

      // -- Step 8: Start services --
      const startSpinner = !isJson ? ora("Starting DaoFlow services...").start() : null;
      try {
        installRuntime.exec("docker compose up -d", {
          cwd: dir,
          stdio: "pipe"
        });
        startSpinner?.succeed("DaoFlow services started");
      } catch (error) {
        startSpinner?.fail("Failed to start services");
        const msg = getExecErrorMessage(error);
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "START_FAILED" }));
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }

      // -- Step 9: Wait for health --
      const healthSpinner = !isJson ? ora("Waiting for DaoFlow to be healthy...").start() : null;
      let healthy = false;
      for (let i = 0; i < 30; i++) {
        try {
          const resp = await installRuntime.fetch(`http://127.0.0.1:${port}/trpc/health`);
          if (resp.ok) {
            healthy = true;
            break;
          }
        } catch {
          // Not ready yet
        }
        await installRuntime.sleep(2000);
      }

      if (healthy) {
        healthSpinner?.succeed("DaoFlow is healthy!");
      } else {
        healthSpinner?.warn("Health check timed out — check 'docker compose logs daoflow'");
      }

      // -- Step 10: Output --
      const url = `${scheme}://${domain}${port !== (scheme === "https" ? 443 : 80) ? `:${port}` : ""}`;

      if (isJson) {
        console.log(
          JSON.stringify({
            ok: true,
            version: CLI_VERSION,
            directory: dir,
            domain,
            port,
            url,
            healthy,
            configFiles: [envPath, composePath]
          })
        );
      } else {
        console.error();
        console.error(chalk.green.bold("✅ DaoFlow installed successfully!"));
        console.error();
        console.error(`  Dashboard:  ${chalk.cyan(url)}`);
        console.error(`  Directory:  ${chalk.dim(dir)}`);
        console.error(`  Version:    ${chalk.dim(CLI_VERSION)}`);
        console.error();
        console.error(chalk.bold("Next steps:"));
        console.error(`  1. Open ${chalk.cyan(url)} and sign in as ${chalk.cyan(email ?? "")}`);
        console.error(`  2. Register your first server`);
        console.error(`  3. Deploy your first application`);
        console.error();
        console.error(chalk.bold("Useful commands:"));
        console.error(`  ${chalk.dim("daoflow doctor --json")}   Check system health`);
        console.error(`  ${chalk.dim("daoflow upgrade --yes")}   Upgrade to latest version`);
        console.error(`  ${chalk.dim(`cd ${dir} && docker compose logs -f`)}  View logs`);
        console.error();
      }

      process.exit(0);
    });
}
