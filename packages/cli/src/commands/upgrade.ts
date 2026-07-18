import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { randomUUID } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import { runCommandAction } from "../command-action";
import { getErrorMessage, getExecErrorMessage } from "../command-helpers";
import { resolveInstallComposeContent, writeInstallComposeContent } from "../install-compose";
import { readDashboardExposureState, type DashboardExposureMode } from "../install-exposure-state";
import { TEMPORAL_WORKER_CONNECTED_DETAIL, waitForInstallHealth } from "../install-health";
import {
  installerRuntime,
  readExistingInstall,
  resolveInstallHealthPort,
  runComposeCommand,
  updateInstalledVersion,
  writeInstallFile
} from "../installer-lifecycle";
import { getInstallWorkflowProfileEnv } from "../install-workflow-profile";
import { waitForTemporalClusterHealth } from "../install-workflow-runtime";
import { defaultInstallDir } from "../templates";

interface UpgradeOptions {
  dir: string;
  version?: string;
  yes?: boolean;
  json?: boolean;
}

export const upgradeRuntime = installerRuntime;

function resolveUpgradeComposeExposureMode(input: {
  dir: string;
  env: Record<string, string>;
}): DashboardExposureMode {
  const exposureState = readDashboardExposureState(input.dir);
  if (exposureState?.mode) {
    return exposureState.mode;
  }

  if (input.env.DAOFLOW_PROXY_NETWORK?.trim() || input.env.DAOFLOW_ACME_EMAIL?.trim()) {
    return "traefik";
  }

  return "none";
}

export function upgradeCommand(): Command {
  return new Command("upgrade")
    .description("Upgrade DaoFlow to the latest version (or a specific version)")
    .option("--dir <path>", "DaoFlow installation directory", defaultInstallDir())
    .option("--version <version>", "Target version (default: latest)")
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Output as structured JSON")
    .action(async (opts: UpgradeOptions, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const existingInstall = readExistingInstall(opts.dir);
          const installState =
            existingInstall ??
            ctx.fail(`No DaoFlow installation found at ${opts.dir}. Run 'daoflow install' first.`, {
              code: "NOT_INSTALLED"
            });

          const targetVersion = opts.version ?? "latest";

          if (!opts.yes) {
            console.error(chalk.bold("\n📦 DaoFlow Upgrade\n"));
            console.error(`  Current version:  ${chalk.dim(installState.version)}`);
            console.error(`  Target version:   ${chalk.cyan(targetVersion)}`);
            console.error(`  Directory:        ${chalk.dim(installState.dir)}`);
            console.error();

            const answer = await upgradeRuntime.prompt("Proceed with upgrade? (y/N)");
            if (answer.toLowerCase() !== "y") {
              return ctx.complete({
                exitCode: 0,
                human: () => {
                  console.error(chalk.yellow("Cancelled."));
                }
              });
            }
          }

          const newEnvContent = updateInstalledVersion(installState.envContent, targetVersion);
          const transactionId = randomUUID();
          const preparedEnvPath = `${installState.envPath}.upgrade-${transactionId}`;
          const preparedComposePath = `${installState.composePath}.upgrade-${transactionId}`;
          writeInstallFile(preparedEnvPath, newEnvContent);
          const envOverrides = {
            DAOFLOW_VERSION: targetVersion,
            ...getInstallWorkflowProfileEnv(installState.workflowProfile)
          };

          const composeSpinner = !ctx.isJson
            ? ora("Fetching version-matched docker-compose.yml...").start()
            : null;
          let hasPreparedCompose = false;
          try {
            writeInstallComposeContent(
              preparedComposePath,
              await resolveInstallComposeContent({
                runtime: upgradeRuntime,
                version: targetVersion,
                exposureMode: resolveUpgradeComposeExposureMode({
                  dir: installState.dir,
                  env: installState.env
                }),
                cloudflareTunnelEnabled: Boolean(installState.env.CLOUDFLARE_TUNNEL_TOKEN?.trim())
              })
            );
            hasPreparedCompose = true;
            composeSpinner?.succeed("docker-compose.yml prepared");
          } catch (error) {
            composeSpinner?.warn(`Could not fetch compose file: ${getErrorMessage(error)}`);
            if (!ctx.isJson) {
              console.error(chalk.dim("  Keeping existing docker-compose.yml"));
            }
          }

          const transactionEnvOverrides = hasPreparedCompose
            ? { ...envOverrides, COMPOSE_FILE: preparedComposePath }
            : envOverrides;

          try {
            const pullSpinner = !ctx.isJson ? ora("Pulling latest Docker images...").start() : null;
            try {
              runComposeCommand({
                runtime: upgradeRuntime,
                dir: installState.dir,
                args: "pull",
                envPath: installState.envPath,
                envOverrides: transactionEnvOverrides
              });
              pullSpinner?.succeed("New images pulled");
            } catch (error) {
              pullSpinner?.fail("Failed to pull target images");
              ctx.fail(getErrorMessage(error), {
                code: "PULL_FAILED",
                humanMessage: getExecErrorMessage(error)
              });
            }

            const temporalEnabled = installState.workflowProfile === "temporal";
            const restartSpinner = !ctx.isJson
              ? ora("Restarting DaoFlow services...").start()
              : null;
            if (temporalEnabled) {
              if (restartSpinner) restartSpinner.text = "Starting Temporal services...";
              try {
                runComposeCommand({
                  runtime: upgradeRuntime,
                  dir: installState.dir,
                  args: "--profile temporal up -d temporal",
                  envPath: installState.envPath,
                  envOverrides: transactionEnvOverrides
                });
              } catch (error) {
                restartSpinner?.fail("Failed to start Temporal services");
                ctx.fail(getErrorMessage(error), {
                  code: "RESTART_FAILED",
                  humanMessage: getExecErrorMessage(error)
                });
              }

              if (restartSpinner) {
                restartSpinner.text = "Waiting for Temporal cluster readiness...";
              }
              const temporalReady = await waitForTemporalClusterHealth({
                runtime: upgradeRuntime,
                dir: installState.dir,
                envPath: installState.envPath,
                envOverrides: transactionEnvOverrides
              });
              if (!temporalReady) {
                restartSpinner?.fail("Temporal cluster readiness timed out");
                ctx.fail("Temporal did not become healthy before the upgrade timeout.", {
                  code: "TEMPORAL_CLUSTER_HEALTH_TIMEOUT",
                  humanMessage:
                    "Temporal did not become healthy before DaoFlow was restarted. Check 'docker compose logs temporal'."
                });
              }
              if (restartSpinner) restartSpinner.text = "Restarting DaoFlow services...";
            }

            try {
              runComposeCommand({
                runtime: upgradeRuntime,
                dir: installState.dir,
                args: temporalEnabled
                  ? "--profile temporal up -d --remove-orphans daoflow"
                  : "up -d --remove-orphans",
                envPath: installState.envPath,
                envOverrides: transactionEnvOverrides
              });
              restartSpinner?.succeed("Services restarted");
            } catch (error) {
              restartSpinner?.fail("Failed to restart services");
              ctx.fail(getErrorMessage(error), {
                code: "RESTART_FAILED",
                humanMessage: getExecErrorMessage(error)
              });
            }

            const healthSpinner = !ctx.isJson
              ? ora("Waiting for DaoFlow startup readiness...").start()
              : null;
            const healthy = await waitForInstallHealth({
              runtime: upgradeRuntime,
              port: resolveInstallHealthPort(installState.env),
              attempts: 20,
              requiredWorkerDetail: temporalEnabled ? TEMPORAL_WORKER_CONNECTED_DETAIL : undefined
            });

            if (healthy) {
              healthSpinner?.succeed("DaoFlow is ready!");
            } else {
              healthSpinner?.fail("Readiness check timed out");
              ctx.fail("DaoFlow did not become ready after upgrade.", {
                code: "READINESS_TIMEOUT",
                extra: {
                  previousVersion: installState.version,
                  newVersion: targetVersion,
                  directory: installState.dir,
                  healthy: false
                },
                humanMessage:
                  "DaoFlow did not become ready after upgrade. Check 'docker compose logs daoflow'."
              });
            }

            try {
              renameSync(preparedEnvPath, installState.envPath);
              if (hasPreparedCompose) {
                renameSync(preparedComposePath, installState.composePath);
              }
            } catch (error) {
              writeInstallFile(installState.envPath, installState.envContent);
              ctx.fail(`Could not commit upgraded configuration: ${getErrorMessage(error)}`, {
                code: "RESTART_FAILED"
              });
            }

            return ctx.complete({
              exitCode: 0,
              json: {
                ok: true,
                previousVersion: installState.version,
                newVersion: targetVersion,
                directory: installState.dir,
                healthy
              },
              human: () => {
                console.error();
                console.error(chalk.green.bold("✅ DaoFlow upgraded successfully!"));
                console.error(
                  `  ${chalk.dim(installState.version)} → ${chalk.cyan(targetVersion)}`
                );
                console.error();
              }
            });
          } finally {
            for (const path of [preparedEnvPath, preparedComposePath]) {
              if (existsSync(path)) unlinkSync(path);
            }
          }
        }
      });
    });
}
