import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { CommandActionError, runCommandAction } from "../command-action";
import { getErrorMessage, getExecErrorMessage } from "../command-helpers";
import { collectInstallConfiguration, type InstallOptions } from "../install-config";
import { configureDashboardExposure } from "../install-exposure";
import { describeDashboardExposureMode } from "../install-exposure-state";
import {
  buildInstallUrl,
  ensureInstallDirectories,
  installerRuntime,
  runComposeCommand,
  updateInstalledPublicUrl,
  waitForInstallHealth,
  writeComposeFile,
  writeInstallFile
} from "../installer-lifecycle";
import { defaultInstallDir, generateEnvFile } from "../templates";
import { CLI_VERSION } from "../version";

export { resolveInitialAdminCredentials } from "../install-credentials";

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
      "Admin email for first user (defaults to DAOFLOW_INITIAL_ADMIN_EMAIL)"
    )
    .option(
      "--password <password>",
      "Admin password for first user (defaults to DAOFLOW_INITIAL_ADMIN_PASSWORD)"
    )
    .option(
      "--expose <mode>",
      "Expose the dashboard after install: none, cloudflare-quick, tailscale-serve, tailscale-funnel",
      "none"
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
          const dockerSpinner = !ctx.isJson ? ora("Checking Docker...").start() : null;
          const docker = installRuntime.checkDocker();

          if (!docker.available) {
            dockerSpinner?.fail("Docker is not installed");
            ctx.fail(
              "Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/",
              { code: "DOCKER_NOT_FOUND" }
            );
          }

          if (!docker.compose) {
            dockerSpinner?.fail("Docker Compose v2 is required");
            ctx.fail("Docker Compose v2 not found", { code: "COMPOSE_NOT_FOUND" });
          }

          dockerSpinner?.succeed(`Docker found: ${docker.version}`);

          const config = await collectInstallConfiguration({
            options: opts,
            command,
            ctx,
            runtime: installRuntime
          });

          if (config.cancelled) {
            return ctx.complete({
              exitCode: 0,
              human: () => {
                console.error(chalk.yellow("Cancelled."));
              }
            });
          }

          const dirSpinner = !ctx.isJson ? ora("Creating installation directory...").start() : null;
          const { envPath, composePath } = ensureInstallDirectories(config.dir);
          dirSpinner?.succeed(`Directory: ${config.dir}`);

          const envSpinner = !ctx.isJson
            ? ora("Generating secrets and configuration...").start()
            : null;
          let envContent = generateEnvFile({
            version: CLI_VERSION,
            domain: config.domain,
            port: config.port,
            scheme: config.scheme,
            initialAdminEmail: config.email,
            initialAdminPassword: config.password,
            postgresPassword: config.postgresPassword,
            temporalPostgresPassword: config.temporalPostgresPassword,
            authSecret: config.existingInstall?.env.BETTER_AUTH_SECRET,
            encryptionKey: config.existingInstall?.env.ENCRYPTION_KEY,
            preservedEnv: config.existingInstall?.env
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
              dir: config.dir,
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
              dir: config.dir,
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
          let healthy = await waitForInstallHealth({
            runtime: installRuntime,
            port: config.port
          });

          if (healthy) {
            healthSpinner?.succeed("DaoFlow is healthy!");
          } else {
            healthSpinner?.warn("Health check timed out — check 'docker compose logs daoflow'");
          }

          const exposureSpinner =
            config.exposureMode !== "none" && !ctx.isJson
              ? ora("Configuring dashboard exposure...").start()
              : null;
          let exposure = await configureDashboardExposure({
            runtime: installRuntime,
            installDir: config.dir,
            mode: config.exposureMode,
            port: config.port
          });

          const displayUrl =
            exposure.url ??
            buildInstallUrl({ domain: config.domain, scheme: config.scheme, port: config.port });

          if (exposure.url) {
            envContent = updateInstalledPublicUrl(envContent, exposure.url);
            writeInstallFile(envPath, envContent);

            const authUrlSpinner = !ctx.isJson
              ? ora(
                  `Applying exposed auth URL (${describeDashboardExposureMode(config.exposureMode)})...`
                ).start()
              : null;
            try {
              runComposeCommand({
                runtime: installRuntime,
                dir: config.dir,
                args: "up -d"
              });
              authUrlSpinner?.succeed("BETTER_AUTH_URL updated to the exposed HTTPS URL");
              healthy = await waitForInstallHealth({
                runtime: installRuntime,
                port: config.port,
                attempts: healthy ? 10 : 20
              });
            } catch (error) {
              authUrlSpinner?.fail("Failed to apply the exposed auth URL");
              exposure = {
                ...exposure,
                ok: false,
                detail: `Exposure was created, but restarting DaoFlow with the new BETTER_AUTH_URL failed: ${getExecErrorMessage(error)}`
              };
            }
          }

          if (exposureSpinner) {
            if (exposure.ok) {
              exposureSpinner.succeed(
                exposure.url
                  ? `Exposure ready: ${exposure.url}`
                  : `Exposure configured: ${describeDashboardExposureMode(config.exposureMode)}`
              );
            } else {
              exposureSpinner.warn(
                exposure.detail ??
                  `Could not configure ${describeDashboardExposureMode(config.exposureMode)}.`
              );
            }
          }

          return ctx.complete({
            exitCode: 0,
            json: {
              ok: true,
              version: CLI_VERSION,
              directory: config.dir,
              domain: config.domain,
              port: config.port,
              url: displayUrl,
              healthy,
              exposure,
              configFiles: [envPath, composePath]
            },
            human: () => {
              console.error();
              console.error(chalk.green.bold("✅ DaoFlow installed successfully!"));
              console.error();
              console.error(`  Dashboard:  ${chalk.cyan(displayUrl)}`);
              console.error(`  Directory:  ${chalk.dim(config.dir)}`);
              console.error(`  Version:    ${chalk.dim(CLI_VERSION)}`);
              if (config.exposureMode !== "none") {
                console.error(
                  `  Exposure:   ${chalk.dim(describeDashboardExposureMode(config.exposureMode))}`
                );
                if (exposure.detail && !exposure.ok) {
                  console.error(`  Warning:    ${chalk.yellow(exposure.detail)}`);
                }
              }
              console.error();
              console.error(chalk.bold("Next steps:"));
              console.error(
                `  1. Open ${chalk.cyan(displayUrl)} and sign in as ${chalk.cyan(config.email)}`
              );
              console.error("  2. Register your first server");
              console.error("  3. Deploy your first application");
              console.error();
              console.error(chalk.bold("Useful commands:"));
              console.error(`  ${chalk.dim("daoflow doctor --json")}   Check system health`);
              console.error(`  ${chalk.dim("daoflow upgrade --yes")}   Upgrade to latest version`);
              console.error(
                `  ${chalk.dim(`cd ${config.dir} && docker compose logs -f`)}  View logs`
              );
              if (exposure.logPath) {
                console.error(`  ${chalk.dim(`tail -f ${exposure.logPath}`)}  Watch tunnel logs`);
              }
              console.error();
            }
          });
        }
      });
    });
}
