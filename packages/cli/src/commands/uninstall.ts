import { Command } from "commander";
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { defaultInstallDir } from "../templates";

export function uninstallCommand(): Command {
  return new Command("uninstall")
    .description("Stop DaoFlow services and optionally remove data")
    .option("--dir <path>", "DaoFlow installation directory", defaultInstallDir())
    .option("--remove-data", "Also remove volumes and database data (destructive)")
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Output as structured JSON")
    .action(async opts => {
      const isJson = opts.json || process.argv.includes("--json");
      const dir = opts.dir;
      const removeData = opts.removeData || false;

      // -- Check installation exists --
      if (!existsSync(join(dir, "docker-compose.yml"))) {
        const msg = `No DaoFlow installation found at ${dir}`;
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "NOT_INSTALLED" }));
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }

      // -- Confirm --
      if (!opts.yes) {
        console.error(chalk.bold("\n⚠️  DaoFlow Uninstall\n"));
        console.error(`  Directory: ${chalk.dim(dir)}`);
        if (removeData) {
          console.error(chalk.red.bold("  WARNING: --remove-data will permanently delete all data!"));
        }
        console.error();

        const rl = await import("readline");
        const iface = rl.createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>(resolve => {
          iface.question(
            removeData
              ? "Type 'DELETE' to confirm permanent data removal: "
              : "Proceed? (y/N): ",
            ans => { iface.close(); resolve(ans.trim()); }
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
      } catch (e: any) {
        stopSpinner?.fail("Failed to stop services");
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: e.message, code: "STOP_FAILED" }));
        } else {
          console.error(chalk.red(e.stderr?.toString() || e.message));
        }
        process.exit(1);
      }

      // -- Output --
      if (isJson) {
        console.log(JSON.stringify({
          ok: true,
          directory: dir,
          dataRemoved: removeData
        }));
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
