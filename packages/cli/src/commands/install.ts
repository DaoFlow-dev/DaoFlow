import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { runCommandAction } from "../command-action";
import { getErrorMessage, getExecErrorMessage } from "../command-helpers";
import {
  captureInstallComposeFile,
  restoreInstallComposeFile,
  writeInstallComposeFile
} from "../install-compose";
import { collectInstallConfiguration, type InstallOptions } from "../install-config";
import { ensureInstallDirectories, installerRuntime } from "../installer-lifecycle";
import {
  InstallEnvironmentPreparationError,
  persistInstallEnvironment,
  prepareInstallEnvironment
} from "../install-environment";
import { finalizeInstallExposure, verifyInstallStartup } from "../install-finalization";
import {
  emitInstallError,
  emitInstallWorkflowProfilePlan,
  renderInstallSuccess
} from "../install-output";
import {
  getInstallWorkflowProfilePlan,
  InstallWorkflowRuntimeError,
  type InstallWorkflowProfileChange
} from "../install-workflow-runtime";
import { runInstallWorkflowWithProgress } from "../install-workflow-runner";
import { defaultInstallDir } from "../templates";
import { CLI_VERSION } from "../version";

export { resolveInitialAdminCredentials } from "../install-credentials";

export const installRuntime = installerRuntime;

export function installCommand(): Command {
  return new Command("install")
    .description(
      "Install DaoFlow on this server — creates a docker-compose project with auto-generated secrets"
    )
    .option("--dir <path>", "Installation directory", defaultInstallDir())
    .option("--domain <hostname>", "Public domain (e.g., deploy.example.com)")
    .option("--port <number>", "Local DaoFlow HTTP port", "3000")
    .option(
      "--workflow-profile <profile>",
      "Workflow profile: lean (default) or temporal (adds workflow orchestration services)",
      "lean"
    )
    .option("--acme-email <email>", "Let's Encrypt email to use when --expose traefik")
    .option(
      "--cloudflare-tunnel",
      "Run a cloudflared sidecar connected to a named Cloudflare Tunnel"
    )
    .option(
      "--cloudflare-tunnel-token <token>",
      "Cloudflare named tunnel token (defaults to CLOUDFLARE_TUNNEL_TOKEN or the preserved install value)"
    )
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
      "Expose the dashboard after install: none, traefik, cloudflare-quick, tailscale-serve, tailscale-funnel",
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

          const permSpinner = !ctx.isJson ? ora("Checking Docker permissions...").start() : null;
          try {
            installRuntime.exec("docker info", { encoding: "utf-8", stdio: "pipe" });
            permSpinner?.succeed("Docker permissions OK");
          } catch (permError) {
            permSpinner?.fail("Insufficient Docker permissions");
            const permMsg = String(permError);
            if (permMsg.includes("permission denied")) {
              ctx.fail(
                "Cannot connect to the Docker daemon. Add your user to the docker group " +
                  "(sudo usermod -aG docker $USER) then log out and back in, or run this installer with sudo.",
                { code: "DOCKER_PERMISSION_DENIED" }
              );
            }
            ctx.fail("Docker daemon is not reachable: " + getErrorMessage(permError), {
              code: "DOCKER_UNREACHABLE"
            });
          }

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

          const workflowProfilePlan = getInstallWorkflowProfilePlan({
            existingWorkflowProfile: config.existingInstall?.workflowProfile ?? null,
            workflowProfile: config.workflowProfile
          });
          if (workflowProfilePlan && (ctx.isJson || opts.yes)) {
            emitInstallWorkflowProfilePlan({ plan: workflowProfilePlan, json: ctx.isJson });
          }

          const dirSpinner = !ctx.isJson ? ora("Creating installation directory...").start() : null;
          const { envPath, composePath } = ensureInstallDirectories(config.dir);
          const composeSnapshot = captureInstallComposeFile(composePath);
          dirSpinner?.succeed(`Directory: ${config.dir}`);

          const envSpinner = !ctx.isJson
            ? ora("Generating secrets and configuration...").start()
            : null;
          let envContent = "";
          try {
            ({ envContent } = prepareInstallEnvironment({
              config,
              version: CLI_VERSION
            }));
          } catch (error) {
            if (error instanceof InstallEnvironmentPreparationError) {
              envSpinner?.fail("Temporal workflow profile needs a Temporal database password");
              ctx.fail(error.message, {
                code: error.code,
                extra: workflowProfilePlan ? { workflowProfilePlan } : undefined
              });
            }
            envSpinner?.fail("Failed to prepare installation configuration");
            ctx.fail(getExecErrorMessage(error), {
              code: "START_FAILED",
              extra: { workflowProfilePlan }
            });
          }
          envSpinner?.succeed("Installation configuration prepared");

          const composeSpinner = !ctx.isJson ? ora("Fetching docker-compose.yml...").start() : null;
          try {
            await writeInstallComposeFile({
              runtime: installRuntime,
              composePath,
              version: CLI_VERSION,
              exposureMode: config.exposureMode,
              cloudflareTunnelEnabled: config.cloudflareTunnelEnabled
            });
            composeSpinner?.succeed("docker-compose.yml written");
          } catch (error) {
            composeSpinner?.fail("Failed to fetch docker-compose.yml");
            ctx.fail(getErrorMessage(error), { code: "COMPOSE_FETCH_FAILED" });
          }

          const persistSpinner = !ctx.isJson
            ? ora("Saving secrets and workflow profile...").start()
            : null;
          let skipTemporalCleanup = false;
          try {
            if (workflowProfilePlan?.change === "temporal-to-lean" && persistSpinner) {
              persistSpinner.text =
                "Switching to lean: removing Temporal containers and keeping their data...";
            }
            ({ skippedTemporalCleanup: skipTemporalCleanup } = persistInstallEnvironment({
              runtime: installRuntime,
              dir: config.dir,
              envPath,
              contents: envContent,
              workflowProfilePlan
            }));
            persistSpinner?.succeed("Secrets and workflow profile saved to .env");
          } catch (error) {
            restoreInstallComposeFile(composePath, composeSnapshot);
            persistSpinner?.fail("Failed to save installation configuration");
            if (error instanceof InstallWorkflowRuntimeError) {
              ctx.fail(error.message, {
                code: error.code,
                extra: { workflowProfilePlan }
              });
            }
            ctx.fail(getExecErrorMessage(error), {
              code: "START_FAILED",
              extra: { workflowProfilePlan }
            });
          }

          const workflowSpinner = !ctx.isJson ? ora("Preparing DaoFlow services...").start() : null;
          let workflowProfileChange: InstallWorkflowProfileChange | null = null;
          try {
            const workflow = await runInstallWorkflowWithProgress({
              runtime: installRuntime,
              dir: config.dir,
              envPath,
              existingWorkflowProfile: config.existingInstall?.workflowProfile ?? null,
              workflowProfile: config.workflowProfile,
              skipTemporalCleanup,
              spinner: workflowSpinner
            });
            workflowProfileChange = workflow.workflowProfileChange;
          } catch (error) {
            if (error instanceof InstallWorkflowRuntimeError) {
              ctx.fail(error.message, { code: error.code });
            }
            ctx.fail(getExecErrorMessage(error), { code: "START_FAILED" });
          }

          const initialHealthy = await verifyInstallStartup({
            runtime: installRuntime,
            config,
            envPath,
            ctx
          });
          const { displayUrl, healthy, exposure, cloudflareTunnel } = await finalizeInstallExposure(
            {
              runtime: installRuntime,
              config,
              envPath,
              envContent,
              healthy: initialHealthy,
              ctx
            }
          );

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
              workflowProfile: config.workflowProfile,
              workflowProfileChange,
              workflowProfilePlan,
              exposure,
              cloudflareTunnel,
              configFiles: [envPath, composePath]
            },
            human: () => {
              renderInstallSuccess({
                displayUrl,
                directory: config.dir,
                version: CLI_VERSION,
                email: config.email,
                exposureMode: config.exposureMode,
                exposure,
                cloudflareTunnel
              });
            }
          });
        }
      });
    });
}
