import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createClient } from "../trpc-client";

export function envCommand(): Command {
  const cmd = new Command("env").description("Manage environment variables");

  cmd
    .command("pull")
    .description("Download .env from DaoFlow to local filesystem")
    .option("--env-id <id>", "Environment ID")
    .option("--output <path>", "Output file path", ".env")
    .action(async (opts: { envId?: string; output: string }) => {
      const trpc = createClient();
      const data = await trpc.environmentVariables.query({ environmentId: opts.envId });

      const lines = data.variables.map((v) =>
        v.isSecret ? `# ${v.key}=<secret>` : `${v.key}=${v.displayValue}`
      );

      writeFileSync(opts.output, lines.join("\n") + "\n");
      console.log(chalk.green(`✓ Wrote ${data.variables.length} variables to ${opts.output}`));
      console.log(
        chalk.dim(`  (${data.variables.filter((v) => v.isSecret).length} secrets masked)`)
      );
    });

  cmd
    .command("push")
    .description("Upload local .env to DaoFlow (encrypted)")
    .requiredOption("--env-id <id>", "Environment ID")
    .option("--input <path>", "Input .env file", ".env")
    .option("--secret", "Mark all variables as secret")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Preview what would be pushed")
    .action(
      async (opts: {
        envId: string;
        input: string;
        secret?: boolean;
        yes?: boolean;
        dryRun?: boolean;
      }) => {
        if (!existsSync(opts.input)) {
          console.error(chalk.red(`✗ File not found: ${opts.input}`));
          process.exit(1);
        }

        const content = readFileSync(opts.input, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
        const vars: { key: string; value: string }[] = [];

        for (const line of lines) {
          const eqIdx = line.indexOf("=");
          if (eqIdx < 0) continue;
          vars.push({
            key: line.slice(0, eqIdx).trim(),
            value: line.slice(eqIdx + 1).trim()
          });
        }

        if (opts.dryRun) {
          console.log(chalk.bold(`\n  Dry-run: ${vars.length} variables from ${opts.input}\n`));
          for (const v of vars) {
            console.log(`    ${v.key}=${opts.secret ? "***" : v.value.slice(0, 40)}`);
          }
          process.exit(3);
        }

        if (!opts.yes) {
          console.error(
            chalk.yellow(
              `This will push ${vars.length} variables to environment ${opts.envId}. Pass --yes to confirm.`
            )
          );
          process.exit(1);
        }

        const trpc = createClient();
        let count = 0;
        for (const v of vars) {
          await trpc.upsertEnvironmentVariable.mutate({
            environmentId: opts.envId,
            key: v.key,
            value: v.value,
            isSecret: opts.secret ?? false,
            category: "runtime"
          });
          count++;
        }

        console.log(chalk.green(`✓ Pushed ${count} variables to environment ${opts.envId}`));
      }
    );

  // ── daoflow env list ──────────────────────────────────────
  cmd
    .command("list")
    .description("List environment variables")
    .option("--env-id <id>", "Environment ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { envId?: string; json?: boolean }) => {
      try {
        const trpc = createClient();
        const data = await trpc.environmentVariables.query({ environmentId: opts.envId });

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, ...data }));
          return;
        }

        console.log(chalk.bold(`\n  Environment Variables (${data.summary.totalVariables})\n`));
        for (const v of data.variables) {
          const value = v.isSecret ? chalk.red("***secret***") : chalk.dim(v.displayValue);
          const cat = chalk.dim(`[${v.category}]`);
          console.log(`  ${chalk.cyan(v.key)} = ${value}  ${cat}`);
        }
        console.log();
      } catch (err) {
        if (opts.json) {
          console.log(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "Unknown",
              code: "API_ERROR"
            })
          );
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : err}`));
        }
        process.exit(1);
      }
    });

  // ── daoflow env set ──────────────────────────────────────
  cmd
    .command("set")
    .description("Set an environment variable")
    .requiredOption("--env-id <id>", "Environment ID")
    .requiredOption("--key <key>", "Variable key")
    .requiredOption("--value <value>", "Variable value")
    .option("--secret", "Mark as secret (encrypted at rest)")
    .option("--category <cat>", "Category: runtime, build, secret", "runtime")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (opts: {
        envId: string;
        key: string;
        value: string;
        secret?: boolean;
        category: string;
        json?: boolean;
        yes?: boolean;
      }) => {
        if (!opts.yes && !opts.json) {
          console.error(
            chalk.yellow(`Set ${opts.key} in environment ${opts.envId}. Pass --yes to confirm.`)
          );
          process.exit(1);
        }

        try {
          const trpc = createClient();
          await trpc.upsertEnvironmentVariable.mutate({
            environmentId: opts.envId,
            key: opts.key,
            value: opts.value,
            isSecret: opts.secret ?? false,
            category: opts.category as "runtime" | "build"
          });

          if (opts.json) {
            console.log(JSON.stringify({ ok: true, key: opts.key, environment: opts.envId }));
          } else {
            console.log(chalk.green(`✓ Set ${opts.key} in environment ${opts.envId}`));
          }
        } catch (err) {
          if (opts.json) {
            console.log(
              JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : "Unknown",
                code: "API_ERROR"
              })
            );
          } else {
            console.error(chalk.red(`✗ ${err instanceof Error ? err.message : err}`));
          }
          process.exit(1);
        }
      }
    );

  // ── daoflow env delete ───────────────────────────────────
  cmd
    .command("delete")
    .description("Delete an environment variable")
    .requiredOption("--env-id <id>", "Environment ID")
    .requiredOption("--key <key>", "Variable key to delete")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts: { envId: string; key: string; json?: boolean; yes?: boolean }) => {
      if (!opts.yes && !opts.json) {
        console.error(
          chalk.yellow(
            `Destructive: delete ${opts.key} from environment ${opts.envId}. Pass --yes.`
          )
        );
        process.exit(1);
      }

      try {
        const trpc = createClient();
        await trpc.deleteEnvironmentVariable.mutate({
          environmentId: opts.envId,
          key: opts.key
        });

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, deleted: opts.key, environment: opts.envId }));
        } else {
          console.log(chalk.green(`✓ Deleted ${opts.key} from environment ${opts.envId}`));
        }
      } catch (err) {
        if (opts.json) {
          console.log(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "Unknown",
              code: "API_ERROR"
            })
          );
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : err}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}
