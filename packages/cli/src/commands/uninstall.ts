import { existsSync } from "fs";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { runCommandAction } from "../command-action";
import { getErrorMessage, getExecErrorMessage } from "../command-helpers";
import {
  discoverInstallations,
  getInstallPaths,
  installerRuntime,
  runComposeCommand
} from "../installer-lifecycle";
import { defaultInstallDir } from "../templates";

interface UninstallOptions {
  dir?: string;
  removeData?: boolean;
  yes?: boolean;
  json?: boolean;
}

export const uninstallRuntime = installerRuntime;

export function uninstallCommand(): Command {
  return new Command("uninstall")
    .description("Stop DaoFlow services and optionally remove data")
    .option("--dir <path>", "DaoFlow installation directory (auto-detected if omitted)")
    .option("--remove-data", "Also remove volumes and database data (destructive)")
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Output as structured JSON")
    .action(async (opts: UninstallOptions, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          let dir = opts.dir;

          if (!dir) {
            const discovered = discoverInstallations(uninstallRuntime.exec);

            if (discovered.length === 1) {
              dir = discovered[0];
              if (!ctx.isJson) {
                console.error(chalk.dim(`  Auto-detected installation at ${dir}`));
              }
            } else if (discovered.length > 1) {
              if (ctx.isJson) {
                ctx.fail("Multiple DaoFlow installations found. Specify --dir explicitly.", {
                  code: "MULTIPLE_INSTALLATIONS",
                  extra: { installations: discovered }
                });
              }

              console.error(chalk.bold("\n🔍 Multiple DaoFlow installations found:\n"));
              discovered.forEach((discoveredDir, index) => {
                console.error(`  ${chalk.cyan(`${index + 1}`)}. ${discoveredDir}`);
              });
              console.error();

              const answer = await uninstallRuntime.prompt(
                `Select installation (1-${discovered.length})`
              );
              const selectedIndex = parseInt(answer, 10) - 1;
              if (
                Number.isNaN(selectedIndex) ||
                selectedIndex < 0 ||
                selectedIndex >= discovered.length
              ) {
                return ctx.complete({
                  exitCode: 0,
                  human: () => {
                    console.error(chalk.yellow("Invalid selection. Cancelled."));
                  }
                });
              }

              dir = discovered[selectedIndex];
            } else {
              dir = defaultInstallDir();
            }
          }

          const finalDir = dir;
          const { composePath } = getInstallPaths(finalDir);
          if (!existsSync(composePath)) {
            const message = `No DaoFlow installation found at ${finalDir}`;
            if (!opts.dir && !ctx.isJson) {
              return ctx.complete({
                exitCode: 1,
                json: { ok: false, error: message, code: "NOT_INSTALLED" },
                human: () => {
                  console.error(chalk.red(message));
                  console.error(
                    chalk.dim(
                      "  Specify --dir <path> if your installation is in a different location."
                    )
                  );
                }
              });
            }

            ctx.fail(message, { code: "NOT_INSTALLED" });
          }

          const removeData = opts.removeData ?? false;
          if (!opts.yes) {
            console.error(chalk.bold("\n⚠️  DaoFlow Uninstall\n"));
            console.error(`  Directory: ${chalk.dim(finalDir)}`);
            if (removeData) {
              console.error(
                chalk.red.bold("  WARNING: --remove-data will permanently delete all data!")
              );
            }
            console.error();

            const answer = await uninstallRuntime.prompt(
              removeData ? "Type 'DELETE' to confirm permanent data removal" : "Proceed? (y/N)"
            );

            if (removeData && answer !== "DELETE") {
              return ctx.complete({
                exitCode: 0,
                human: () => {
                  console.error(chalk.yellow("Cancelled."));
                }
              });
            }

            if (!removeData && answer.toLowerCase() !== "y") {
              return ctx.complete({
                exitCode: 0,
                human: () => {
                  console.error(chalk.yellow("Cancelled."));
                }
              });
            }
          }

          const stopSpinner = !ctx.isJson ? ora("Stopping DaoFlow services...").start() : null;
          try {
            runComposeCommand({
              runtime: uninstallRuntime,
              dir: finalDir,
              args: removeData ? "down -v --remove-orphans" : "down --remove-orphans"
            });
            stopSpinner?.succeed("Services stopped");
          } catch (error) {
            stopSpinner?.fail("Failed to stop services");
            ctx.fail(getErrorMessage(error), {
              code: "STOP_FAILED",
              humanMessage: getExecErrorMessage(error)
            });
          }

          return ctx.complete({
            exitCode: 0,
            json: {
              ok: true,
              directory: finalDir,
              dataRemoved: removeData
            },
            human: () => {
              console.error();
              if (removeData) {
                console.error(chalk.yellow("DaoFlow stopped and all data removed."));
              } else {
                console.error(chalk.green("DaoFlow stopped. Data volumes are preserved."));
                console.error(chalk.dim(`  To restart: cd ${finalDir} && docker compose up -d`));
                console.error(chalk.dim("  To remove data: daoflow uninstall --remove-data --yes"));
              }
              console.error();
            }
          });
        }
      });
    });
}
