import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { CommandActionError, runCommandAction } from "../command-action";
import { getErrorMessage, getExecErrorMessage } from "../command-helpers";
import { defaultInstallDir, generateEnvFile } from "../templates";
import { CLI_VERSION } from "../version";
import {
  buildInstallUrl,
  ensureInstallDirectories,
  installerRuntime,
  type ExistingInstallState,
  parsePort,
  readExistingInstall,
  runComposeCommand,
  writeInstallFile,
  writeComposeFile,
  waitForInstallHealth
} from "../installer-lifecycle";

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
export const installRuntime = installerRuntime;

export function buildInstallErrorPayload(error: CommandActionError): Record<string, unknown> {
  return { ...(error.extra ?? {}), ok: false, error: error.message, code: error.code };
}

function emitInstallError(error: CommandActionError, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(buildInstallErrorPayload(error)));
    return;
  }

  if (error.code === "DOCKER_NOT_FOUND") {
    console.error(chalk.red("\nDocker is required. Install it first:"));
    console.error(chalk.dim("  https://docs.docker.com/engine/install/"));
    console.error(chalk.dim("  Or: curl -fsSL https://get.docker.com | sh"));
    return;
  }

  console.error(chalk.red(error.humanMessage ?? error.message));
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
      await runCommandAction({
        command,
        json: opts.json,
        renderError: (error, ctx) => {
          emitInstallError(error, ctx.isJson);
        },
        action: async (ctx) => {
          const isNonInteractive = opts.yes ?? false;
          const hasExplicitDomain = command.getOptionValueSource("domain") === "cli";
          const hasExplicitPort = command.getOptionValueSource("port") === "cli";

          const spinner = !ctx.isJson ? ora("Checking Docker...").start() : null;
          const docker = installRuntime.checkDocker();

          if (!docker.available) {
            spinner?.fail("Docker is not installed");
            ctx.fail(
              "Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/",
              { code: "DOCKER_NOT_FOUND" }
            );
          }

          if (!docker.compose) {
            spinner?.fail("Docker Compose v2 is required");
            ctx.fail("Docker Compose v2 not found", { code: "COMPOSE_NOT_FOUND" });
          }

          spinner?.succeed(`Docker found: ${docker.version}`);

          let dir = opts.dir;
          let domain = opts.domain ?? "localhost";
          let port = parsePort(opts.port);
          let scheme: "http" | "https" = domain === "localhost" ? "http" : "https";
          if (port === null) {
            ctx.fail(`Invalid port "${opts.port}". Use an integer between 1 and 65535.`, {
              code: "INVALID_PORT"
            });
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
              ctx.fail(`Invalid port "${portStr}". Use an integer between 1 and 65535.`, {
                code: "INVALID_PORT"
              });
            }
            email = await installRuntime.prompt("Admin email", email);
            if (password) {
              console.error(chalk.dim("Admin password already provided via flag or environment."));
            } else {
              password = await installRuntime.prompt("Admin password");
            }

            if (!email || !password) {
              ctx.fail("Email and password are required for the admin account.");
            }

            if (password.length < 8) {
              ctx.fail("Admin password must be at least 8 characters.");
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
                  ctx.fail("Both database passwords are required.");
                }
                databasePasswordMode = "manual";
              } else {
                console.error(chalk.dim("  Secure passwords will be auto-generated."));
              }

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
              return ctx.complete({
                exitCode: 0,
                human: () => {
                  console.error(chalk.yellow("Cancelled."));
                }
              });
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
              if (!ctx.isJson) {
                console.error(
                  chalk.yellow(
                    `Existing DaoFlow installation found (v${existingInstall.version}); preserving current secrets and settings unless explicitly overridden.`
                  )
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
          }

          const finalPort = requireInstallValue(port, () =>
            ctx.fail(`Invalid port "${opts.port}". Use an integer between 1 and 65535.`, {
              code: "INVALID_PORT"
            })
          );
          const finalEmail = requireInstallValue(email, () =>
            ctx.fail("Admin email is required for installation.", {
              code: "MISSING_EMAIL"
            })
          );
          const finalPassword = requireInstallValue(password, () =>
            ctx.fail("Admin password is required for installation.", {
              code: "MISSING_PASSWORD"
            })
          );

          const dirSpinner = !ctx.isJson ? ora("Creating installation directory...").start() : null;
          const { envPath, composePath } = ensureInstallDirectories(dir);
          dirSpinner?.succeed(`Directory: ${dir}`);

          const envSpinner = !ctx.isJson
            ? ora("Generating secrets and configuration...").start()
            : null;
          const envContent = generateEnvFile({
            version: CLI_VERSION,
            domain,
            port: finalPort,
            scheme,
            initialAdminEmail: finalEmail,
            initialAdminPassword: finalPassword,
            postgresPassword: opts._pgPassword ?? existingInstall?.env.POSTGRES_PASSWORD,
            temporalPostgresPassword:
              opts._temporalPgPassword ?? existingInstall?.env.TEMPORAL_POSTGRES_PASSWORD,
            authSecret: existingInstall?.env.BETTER_AUTH_SECRET,
            encryptionKey: existingInstall?.env.ENCRYPTION_KEY,
            preservedEnv: existingInstall?.env
          });
          writeInstallFile(envPath, envContent);
          envSpinner?.succeed("Secrets generated and saved to .env");

          const composeSpinner = !ctx.isJson ? ora("Fetching docker-compose.yml...").start() : null;
          try {
            await writeComposeFile(installRuntime, composePath);
            composeSpinner?.succeed("docker-compose.yml written");
          } catch (error) {
            composeSpinner?.fail("Failed to fetch docker-compose.yml");
            ctx.fail(getErrorMessage(error), { code: "COMPOSE_FETCH_FAILED" });
          }

          const pullSpinner = !ctx.isJson
            ? ora("Pulling Docker images (this may take a minute)...").start()
            : null;
          try {
            runComposeCommand({
              runtime: installRuntime,
              dir,
              args: "pull",
              envPath
            });
            pullSpinner?.succeed("Docker images pulled");
          } catch {
            pullSpinner?.warn("Image pull failed — will attempt to start anyway");
          }

          const startSpinner = !ctx.isJson ? ora("Starting DaoFlow services...").start() : null;
          try {
            runComposeCommand({
              runtime: installRuntime,
              dir,
              args: "up -d"
            });
            startSpinner?.succeed("DaoFlow services started");
          } catch (error) {
            startSpinner?.fail("Failed to start services");
            ctx.fail(getExecErrorMessage(error), { code: "START_FAILED" });
          }

          const healthSpinner = !ctx.isJson
            ? ora("Waiting for DaoFlow to be healthy...").start()
            : null;
          const healthy = await waitForInstallHealth({
            runtime: installRuntime,
            port: finalPort
          });

          if (healthy) {
            healthSpinner?.succeed("DaoFlow is healthy!");
          } else {
            healthSpinner?.warn("Health check timed out — check 'docker compose logs daoflow'");
          }

          const displayUrl = buildInstallUrl({ domain, scheme, port: finalPort });

          return ctx.complete({
            exitCode: 0,
            json: {
              ok: true,
              version: CLI_VERSION,
              directory: dir,
              domain,
              port: finalPort,
              url: displayUrl,
              healthy,
              configFiles: [envPath, composePath]
            },
            human: () => {
              console.error();
              console.error(chalk.green.bold("✅ DaoFlow installed successfully!"));
              console.error();
              console.error(`  Dashboard:  ${chalk.cyan(displayUrl)}`);
              console.error(`  Directory:  ${chalk.dim(dir)}`);
              console.error(`  Version:    ${chalk.dim(CLI_VERSION)}`);
              console.error();
              console.error(chalk.bold("Next steps:"));
              console.error(
                `  1. Open ${chalk.cyan(displayUrl)} and sign in as ${chalk.cyan(finalEmail)}`
              );
              console.error(`  2. Register your first server`);
              console.error(`  3. Deploy your first application`);
              console.error();
              console.error(chalk.bold("Useful commands:"));
              console.error(`  ${chalk.dim("daoflow doctor --json")}   Check system health`);
              console.error(`  ${chalk.dim("daoflow upgrade --yes")}   Upgrade to latest version`);
              console.error(`  ${chalk.dim(`cd ${dir} && docker compose logs -f`)}  View logs`);
              console.error();
            }
          });
        }
      });
    });
}
