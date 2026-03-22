import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { runCommandAction } from "../command-action";
import { getErrorMessage, getExecErrorMessage } from "../command-helpers";
import {
  installerRuntime,
  readExistingInstall,
  resolveInstallHealthPort,
  runComposeCommand,
  updateInstalledVersion,
  waitForInstallHealth,
  writeComposeFile,
  writeInstallFile
} from "../installer-lifecycle";
import { defaultInstallDir } from "../templates";

interface UpgradeOptions {
  dir: string;
  version?: string;
  yes?: boolean;
  json?: boolean;
}

export const upgradeRuntime = installerRuntime;

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
          const envOverrides = { DAOFLOW_VERSION: targetVersion };

          const composeSpinner = !ctx.isJson
            ? ora("Fetching latest docker-compose.yml...").start()
            : null;
          try {
            await writeComposeFile(upgradeRuntime, installState.composePath);
            composeSpinner?.succeed("docker-compose.yml updated");
          } catch (error) {
            composeSpinner?.warn(`Could not fetch latest compose file: ${getErrorMessage(error)}`);
            if (!ctx.isJson) {
              console.error(chalk.dim("  Keeping existing docker-compose.yml"));
            }
          }

          const pullSpinner = !ctx.isJson ? ora("Pulling latest Docker images...").start() : null;
          try {
            runComposeCommand({
              runtime: upgradeRuntime,
              dir: installState.dir,
              args: "pull",
              envPath: installState.envPath,
              envOverrides
            });
            pullSpinner?.succeed("New images pulled");
          } catch (error) {
            pullSpinner?.fail("Failed to pull target images");
            ctx.fail(getErrorMessage(error), {
              code: "PULL_FAILED",
              humanMessage: getExecErrorMessage(error)
            });
          }

          const restartSpinner = !ctx.isJson ? ora("Restarting DaoFlow services...").start() : null;
          try {
            runComposeCommand({
              runtime: upgradeRuntime,
              dir: installState.dir,
              args: "up -d --remove-orphans",
              envPath: installState.envPath,
              envOverrides
            });
            restartSpinner?.succeed("Services restarted");
          } catch (error) {
            restartSpinner?.fail("Failed to restart services");
            ctx.fail(getErrorMessage(error), {
              code: "RESTART_FAILED",
              humanMessage: getExecErrorMessage(error)
            });
          }

          writeInstallFile(installState.envPath, newEnvContent);

          const healthSpinner = !ctx.isJson ? ora("Waiting for health check...").start() : null;
          const healthy = await waitForInstallHealth({
            runtime: upgradeRuntime,
            port: resolveInstallHealthPort(installState.env),
            attempts: 20
          });

          if (healthy) {
            healthSpinner?.succeed("DaoFlow is healthy!");
          } else {
            healthSpinner?.warn("Health check timed out — check 'docker compose logs daoflow'");
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
              console.error(`  ${chalk.dim(installState.version)} → ${chalk.cyan(targetVersion)}`);
              console.error();
            }
          });
        }
      });
    });
}
