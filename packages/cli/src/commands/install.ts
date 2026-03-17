import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createInterface } from "readline";
import chalk from "chalk";
import ora from "ora";
import { fetchComposeYml, generateEnvFile, defaultInstallDir, parseEnvFile } from "../templates";

const VERSION = "0.1.0";

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

export function installCommand(): Command {
  return new Command("install")
    .description(
      "Install DaoFlow on this server — creates a docker-compose project with auto-generated secrets"
    )
    .option("--dir <path>", "Installation directory", defaultInstallDir())
    .option("--domain <hostname>", "Public domain (e.g., deploy.example.com)")
    .option("--port <number>", "HTTP port", "3000")
    .option("--email <email>", "Admin email for first user")
    .option("--password <password>", "Admin password for first user")
    .option("--yes", "Skip confirmation prompts")
    .option("--json", "Output as structured JSON")
    .action(async (opts) => {
      const isJson = opts.json || process.argv.includes("--json");
      const isNonInteractive = opts.yes || false;

      // -- Step 1: Check Docker --
      const spinner = !isJson ? ora("Checking Docker...").start() : null;
      const docker = checkDocker();

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
      let domain = opts.domain;
      let port = parseInt(opts.port, 10);
      let email = opts.email;
      let password = opts.password;

      if (!isNonInteractive) {
        console.error(chalk.bold("\n🚀 DaoFlow Installer\n"));
        console.error(
          chalk.dim("This will create a production DaoFlow instance on this server.\n")
        );

        dir = await prompt("Install directory", dir);
        domain = await prompt("Domain name", domain || "localhost");
        const portStr = await prompt("HTTP port", String(port));
        port = parseInt(portStr, 10);
        email = await prompt("Admin email", email);
        password = await prompt("Admin password", password);

        if (!email || !password) {
          console.error(chalk.red("Email and password are required for the admin account."));
          process.exit(1);
        }

        // Password generation choice
        const pwChoice = await prompt(
          "Database passwords — auto-generate or enter manually? (auto/manual)",
          "auto"
        );

        let pgPassword: string | undefined;
        let temporalPgPassword: string | undefined;

        if (pwChoice.toLowerCase() === "manual") {
          pgPassword = await prompt("Postgres password (daoflow DB)");
          temporalPgPassword = await prompt("Postgres password (temporal DB)");
          if (!pgPassword || !temporalPgPassword) {
            console.error(chalk.red("Both database passwords are required."));
            process.exit(1);
          }
        } else {
          console.error(chalk.dim("  Secure passwords will be auto-generated."));
        }

        // Store for later use in generateEnvFile
        opts._pgPassword = pgPassword;
        opts._temporalPgPassword = temporalPgPassword;

        console.error();
        console.error(chalk.bold("Configuration:"));
        console.error(`  Directory:     ${chalk.cyan(dir)}`);
        console.error(`  Domain:        ${chalk.cyan(domain)}`);
        console.error(`  Port:          ${chalk.cyan(String(port))}`);
        console.error(`  Admin:         ${chalk.cyan(email)}`);
        console.error(`  DB Passwords:  ${chalk.cyan(pgPassword ? "manual" : "auto-generated")}`);
        console.error();

        const confirm = await prompt("Proceed? (y/N)", "y");
        if (confirm.toLowerCase() !== "y") {
          console.error(chalk.yellow("Cancelled."));
          process.exit(0);
        }
      } else {
        // Non-interactive validation
        if (!domain) domain = "localhost";
        if (!email) {
          const msg = "Admin email is required (--email)";
          if (isJson) console.log(JSON.stringify({ ok: false, error: msg, code: "MISSING_EMAIL" }));
          else console.error(chalk.red(msg));
          process.exit(1);
        }
        if (!password) {
          const msg = "Admin password is required (--password)";
          if (isJson)
            console.log(JSON.stringify({ ok: false, error: msg, code: "MISSING_PASSWORD" }));
          else console.error(chalk.red(msg));
          process.exit(1);
        }
      }

      // -- Step 3: Check for existing install --
      const envPath = join(dir, ".env");
      const composePath = join(dir, "docker-compose.yml");

      if (existsSync(envPath)) {
        const existing = parseEnvFile(readFileSync(envPath, "utf-8"));
        const existingVersion = existing.DAOFLOW_VERSION || "unknown";

        if (!isNonInteractive) {
          console.error(
            chalk.yellow(`\nExisting DaoFlow installation found (v${existingVersion}).`)
          );
          const overwrite = await prompt("Overwrite? This will regenerate secrets. (y/N)", "n");
          if (overwrite.toLowerCase() !== "y") {
            console.error(chalk.dim("Use 'daoflow upgrade' to update to a new version instead."));
            process.exit(0);
          }
        } else {
          console.error(chalk.yellow(`Overwriting existing installation (v${existingVersion}).`));
        }
      }

      // -- Step 4: Create directory --
      const dirSpinner = !isJson ? ora("Creating installation directory...").start() : null;
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(dir, "backups"), { recursive: true });
      dirSpinner?.succeed(`Directory: ${dir}`);

      // -- Step 5: Generate .env --
      const envSpinner = !isJson ? ora("Generating secrets and configuration...").start() : null;
      const envContent = generateEnvFile({
        version: VERSION,
        domain,
        port,
        postgresPassword: opts._pgPassword,
        temporalPostgresPassword: opts._temporalPgPassword
      });
      writeFileSync(envPath, envContent, { mode: 0o600 });
      envSpinner?.succeed("Secrets generated and saved to .env");

      // -- Step 6: Fetch docker-compose.yml --
      const composeSpinner = !isJson ? ora("Fetching docker-compose.yml...").start() : null;
      try {
        const composeContent = await fetchComposeYml();
        writeFileSync(composePath, composeContent);
        composeSpinner?.succeed("docker-compose.yml written");
      } catch (e: any) {
        composeSpinner?.fail("Failed to fetch docker-compose.yml");
        if (isJson) {
          console.log(
            JSON.stringify({ ok: false, error: e.message, code: "COMPOSE_FETCH_FAILED" })
          );
        } else {
          console.error(chalk.red(e.message));
        }
        process.exit(1);
      }

      // -- Step 7: Pull images --
      const pullSpinner = !isJson
        ? ora("Pulling Docker images (this may take a minute)...").start()
        : null;
      try {
        execSync("docker compose pull", {
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
        execSync("docker compose up -d", {
          cwd: dir,
          stdio: "pipe"
        });
        startSpinner?.succeed("DaoFlow services started");
      } catch (e: any) {
        startSpinner?.fail("Failed to start services");
        const msg = e.stderr?.toString() || e.message;
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
          const resp = await fetch(`http://127.0.0.1:${port}/trpc/health`);
          if (resp.ok) {
            healthy = true;
            break;
          }
        } catch {
          // Not ready yet
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (healthy) {
        healthSpinner?.succeed("DaoFlow is healthy!");
      } else {
        healthSpinner?.warn("Health check timed out — check 'docker compose logs daoflow'");
      }

      // -- Step 10: Output --
      const scheme = domain === "localhost" ? "http" : "https";
      const url = `${scheme}://${domain}${port !== (scheme === "https" ? 443 : 80) ? `:${port}` : ""}`;

      if (isJson) {
        console.log(
          JSON.stringify({
            ok: true,
            version: VERSION,
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
        console.error(`  Version:    ${chalk.dim(VERSION)}`);
        console.error();
        console.error(chalk.bold("Next steps:"));
        console.error(`  1. Open ${chalk.cyan(url)} and create your admin account`);
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
