import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { getErrorMessage, getExecErrorMessage, resolveCommandJsonOption } from "../command-helpers";
import { defaultInstallDir, parseEnvFile, fetchComposeYml } from "../templates";

interface UpgradeOptions {
  dir: string;
  version?: string;
  yes?: boolean;
  json?: boolean;
}

export function upgradeCommand(): Command {
  return new Command("upgrade")
    .description("Upgrade DaoFlow to the latest version (or a specific version)")
    .option("--dir <path>", "DaoFlow installation directory", defaultInstallDir())
    .option("--version <version>", "Target version (default: latest)")
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Output as structured JSON")
    .action(async (opts: UpgradeOptions, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const dir = opts.dir;
      const envPath = join(dir, ".env");
      const composePath = join(dir, "docker-compose.yml");

      // -- Check installation exists --
      if (!existsSync(envPath)) {
        const msg = `No DaoFlow installation found at ${dir}. Run 'daoflow install' first.`;
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: msg, code: "NOT_INSTALLED" }));
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }

      // -- Read current env --
      const envContent = readFileSync(envPath, "utf-8");
      const env = parseEnvFile(envContent);
      const currentVersion = env.DAOFLOW_VERSION || "unknown";
      const targetVersion = opts.version ?? "latest";

      if (!opts.yes) {
        console.error(chalk.bold("\n📦 DaoFlow Upgrade\n"));
        console.error(`  Current version:  ${chalk.dim(currentVersion)}`);
        console.error(`  Target version:   ${chalk.cyan(targetVersion)}`);
        console.error(`  Directory:        ${chalk.dim(dir)}`);
        console.error();

        // Simple y/n prompt
        const rl = await import("readline");
        const iface = rl.createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>((resolve) => {
          iface.question("Proceed with upgrade? (y/N): ", (ans) => {
            iface.close();
            resolve(ans.trim());
          });
        });
        if (answer.toLowerCase() !== "y") {
          console.error(chalk.yellow("Cancelled."));
          process.exit(0);
        }
      }

      // -- Step 1: Update .env version --
      const updateSpinner = !isJson ? ora("Updating configuration...").start() : null;
      let newEnv = envContent;
      if (envContent.includes("DAOFLOW_VERSION=")) {
        newEnv = envContent.replace(/DAOFLOW_VERSION=.*/, `DAOFLOW_VERSION=${targetVersion}`);
      } else {
        newEnv = `DAOFLOW_VERSION=${targetVersion}\n${envContent}`;
      }
      writeFileSync(envPath, newEnv, { mode: 0o600 });
      updateSpinner?.succeed(`Version set to ${targetVersion}`);

      // -- Step 2: Fetch latest docker-compose.yml --
      const composeSpinner = !isJson ? ora("Fetching latest docker-compose.yml...").start() : null;
      try {
        const composeContent = await fetchComposeYml();
        writeFileSync(composePath, composeContent);
        composeSpinner?.succeed("docker-compose.yml updated");
      } catch (error) {
        composeSpinner?.warn(`Could not fetch latest compose file: ${getErrorMessage(error)}`);
        if (!isJson) console.error(chalk.dim("  Keeping existing docker-compose.yml"));
      }

      // -- Step 3: Pull new images --
      const pullSpinner = !isJson ? ora("Pulling latest Docker images...").start() : null;
      try {
        execSync("docker compose pull", { cwd: dir, stdio: "pipe" });
        pullSpinner?.succeed("New images pulled");
      } catch {
        pullSpinner?.warn("Pull failed — will try to restart with cached images");
      }

      // -- Step 4: Restart services --
      const restartSpinner = !isJson ? ora("Restarting DaoFlow services...").start() : null;
      try {
        execSync("docker compose up -d --remove-orphans", { cwd: dir, stdio: "pipe" });
        restartSpinner?.succeed("Services restarted");
      } catch (error) {
        restartSpinner?.fail("Failed to restart services");
        if (isJson) {
          console.log(
            JSON.stringify({
              ok: false,
              error: getErrorMessage(error),
              code: "RESTART_FAILED"
            })
          );
        } else {
          console.error(chalk.red(getExecErrorMessage(error)));
        }
        process.exit(1);
      }

      // -- Step 5: Wait for health --
      const port = parseInt(env.DAOFLOW_PORT || env.PORT || "3000", 10);
      const healthSpinner = !isJson ? ora("Waiting for health check...").start() : null;
      let healthy = false;
      for (let i = 0; i < 20; i++) {
        try {
          const resp = await fetch(`http://127.0.0.1:${port}/trpc/health`);
          if (resp.ok) {
            healthy = true;
            break;
          }
        } catch {
          /* not ready */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (healthy) {
        healthSpinner?.succeed("DaoFlow is healthy!");
      } else {
        healthSpinner?.warn("Health check timed out — check 'docker compose logs daoflow'");
      }

      // -- Output --
      if (isJson) {
        console.log(
          JSON.stringify({
            ok: true,
            previousVersion: currentVersion,
            newVersion: targetVersion,
            directory: dir,
            healthy
          })
        );
      } else {
        console.error();
        console.error(chalk.green.bold("✅ DaoFlow upgraded successfully!"));
        console.error(`  ${chalk.dim(currentVersion)} → ${chalk.cyan(targetVersion)}`);
        console.error();
      }

      process.exit(0);
    });
}
