import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { getErrorMessage, getExecErrorMessage, resolveCommandJsonOption } from "../command-helpers";
import { defaultInstallDir } from "../templates";

interface UninstallOptions {
  dir?: string;
  removeData?: boolean;
  yes?: boolean;
  json?: boolean;
}

/**
 * Auto-discover running DaoFlow installations by inspecting Docker containers.
 *
 * Strategy:
 *   1. Run `docker ps` filtered for images containing "daoflow"
 *   2. Extract the compose working directory from container labels
 *   3. Return unique directories found
 */
function discoverInstallations(): string[] {
  try {
    // Find containers whose image name contains "daoflow"
    const output = execSync(
      'docker ps --filter "ancestor=*daoflow*" --format "{{.Labels}}" 2>/dev/null || ' +
        'docker ps --format "{{.Image}} {{.Labels}}" 2>/dev/null',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    const dirs = new Set<string>();

    // Try to get working_dir from compose labels
    for (const line of output.split("\n")) {
      if (!line.includes("daoflow")) continue;

      // Extract com.docker.compose.project.working_dir from labels
      const match = line.match(/com\.docker\.compose\.project\.working_dir=([^,\s]+)/);
      if (match?.[1]) {
        dirs.add(match[1]);
      }
    }

    // Fallback: inspect compose project containers directly
    if (dirs.size === 0) {
      try {
        const psOutput = execSync('docker ps --format "{{.ID}}" --filter "name=daoflow"', {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"]
        }).trim();

        for (const containerId of psOutput.split("\n").filter(Boolean)) {
          // Validate container ID is hex-only to prevent command injection
          if (!/^[a-f0-9]+$/i.test(containerId)) continue;
          try {
            const inspectOutput = execSync(
              `docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' ${containerId}`,
              { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
            ).trim();
            if (inspectOutput && inspectOutput !== "<no value>") {
              dirs.add(inspectOutput);
            }
          } catch {
            /* container inspect failed */
          }
        }
      } catch {
        /* docker ps failed */
      }
    }

    return [...dirs];
  } catch {
    return [];
  }
}

export function uninstallCommand(): Command {
  return new Command("uninstall")
    .description("Stop DaoFlow services and optionally remove data")
    .option("--dir <path>", "DaoFlow installation directory (auto-detected if omitted)")
    .option("--remove-data", "Also remove volumes and database data (destructive)")
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Output as structured JSON")
    .action(async (opts: UninstallOptions, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      // -- Resolve installation directory --
      let dir = opts.dir;

      if (!dir) {
        // Auto-discover running DaoFlow installations
        const discovered = discoverInstallations();

        if (discovered.length === 1) {
          dir = discovered[0]!;
          if (!isJson) {
            console.error(chalk.dim(`  Auto-detected installation at ${dir}`));
          }
        } else if (discovered.length > 1) {
          if (isJson) {
            console.log(
              JSON.stringify({
                ok: false,
                error: "Multiple DaoFlow installations found. Specify --dir explicitly.",
                code: "MULTIPLE_INSTALLATIONS",
                installations: discovered
              })
            );
            process.exit(1);
          }

          // Interactive selection
          console.error(chalk.bold("\n🔍 Multiple DaoFlow installations found:\n"));
          discovered.forEach((d, i) => {
            console.error(`  ${chalk.cyan(`${i + 1}`)}. ${d}`);
          });
          console.error();

          const rl = await import("readline");
          const iface = rl.createInterface({ input: process.stdin, output: process.stderr });
          const answer = await new Promise<string>((resolve) => {
            iface.question(`Select installation (1-${discovered.length}): `, (ans) => {
              iface.close();
              resolve(ans.trim());
            });
          });
          const idx = parseInt(answer, 10) - 1;
          if (isNaN(idx) || idx < 0 || idx >= discovered.length) {
            console.error(chalk.yellow("Invalid selection. Cancelled."));
            process.exit(0);
          }
          dir = discovered[idx]!;
        } else {
          // No containers found, fall back to default
          dir = defaultInstallDir();
        }
      }

      // -- Check installation exists --
      if (!existsSync(join(dir, "docker-compose.yml"))) {
        const msg = `No DaoFlow installation found at ${dir}`;
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "NOT_INSTALLED" }));
        } else {
          console.error(chalk.red(msg));
          if (!opts.dir) {
            console.error(
              chalk.dim("  Specify --dir <path> if your installation is in a different location.")
            );
          }
        }
        process.exit(1);
      }

      // -- Confirm --
      const removeData = opts.removeData ?? false;
      if (!opts.yes) {
        console.error(chalk.bold("\n⚠️  DaoFlow Uninstall\n"));
        console.error(`  Directory: ${chalk.dim(dir)}`);
        if (removeData) {
          console.error(
            chalk.red.bold("  WARNING: --remove-data will permanently delete all data!")
          );
        }
        console.error();

        const rl = await import("readline");
        const iface = rl.createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>((resolve) => {
          iface.question(
            removeData ? "Type 'DELETE' to confirm permanent data removal: " : "Proceed? (y/N): ",
            (ans) => {
              iface.close();
              resolve(ans.trim());
            }
          );
        });

        if (removeData && answer !== "DELETE") {
          console.error(chalk.yellow("Cancelled."));
          process.exit(0);
        }
        if (!removeData && answer.toLowerCase() !== "y") {
          console.error(chalk.yellow("Cancelled."));
          process.exit(0);
        }
      }

      // -- Stop services --
      const stopSpinner = !isJson ? ora("Stopping DaoFlow services...").start() : null;
      try {
        const downFlags = removeData ? "down -v --remove-orphans" : "down --remove-orphans";
        execSync(`docker compose ${downFlags}`, { cwd: dir, stdio: "pipe" });
        stopSpinner?.succeed("Services stopped");
      } catch (error) {
        stopSpinner?.fail("Failed to stop services");
        if (isJson) {
          console.log(
            JSON.stringify({ ok: false, error: getErrorMessage(error), code: "STOP_FAILED" })
          );
        } else {
          console.error(chalk.red(getExecErrorMessage(error)));
        }
        process.exit(1);
      }

      // -- Output --
      if (isJson) {
        console.log(
          JSON.stringify({
            ok: true,
            directory: dir,
            dataRemoved: removeData
          })
        );
      } else {
        console.error();
        if (removeData) {
          console.error(chalk.yellow("DaoFlow stopped and all data removed."));
        } else {
          console.error(chalk.green("DaoFlow stopped. Data volumes are preserved."));
          console.error(chalk.dim("  To restart: cd " + dir + " && docker compose up -d"));
          console.error(chalk.dim("  To remove data: daoflow uninstall --remove-data --yes"));
        }
        console.error();
      }

      process.exit(0);
    });
}
