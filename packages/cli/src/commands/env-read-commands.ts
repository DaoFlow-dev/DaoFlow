import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { runCommandAction } from "../command-action";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  normalizeCliInput,
  normalizeOptionalCliInput,
  resolveCommandJsonOption
} from "../command-helpers";
import { createClient } from "../trpc-client";

export function registerEnvReadCommands(cmd: Command): void {
  registerEnvPullCommand(cmd);
  registerEnvListCommand(cmd);
  registerEnvResolveCommand(cmd);
}

function registerEnvPullCommand(cmd: Command): void {
  cmd
    .command("pull")
    .description("Download .env from DaoFlow to local filesystem")
    .option("--env-id <id>", "Environment ID")
    .option("--output <path>", "Output file path", ".env")
    .option("--json", "Output as JSON")
    .action(async (opts: { envId?: string; output: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const environmentId = normalizeOptionalCliInput(opts.envId, "Environment ID");
          const outputPath = normalizeCliInput(opts.output, "Output path", {
            allowPathTraversal: true,
            maxLength: 1024
          });
          const data = await trpc.environmentVariables.query({ environmentId });
          const lines = data.variables.map((v) =>
            v.isSecret ? `# ${v.key}=<secret>` : `${v.key}=${v.displayValue}`
          );
          const maskedSecretCount = data.variables.filter((v) => v.isSecret).length;

          writeFileSync(outputPath, lines.join("\n") + "\n");

          return ctx.success(
            {
              environmentId: environmentId ?? null,
              output: outputPath,
              variableCount: data.variables.length,
              maskedSecretCount
            },
            {
              human: () => {
                console.log(
                  chalk.green(`✓ Wrote ${data.variables.length} variables to ${outputPath}`)
                );
                console.log(chalk.dim(`  (${maskedSecretCount} secrets masked)`));
              }
            }
          );
        }
      });
    });
}

function registerEnvListCommand(cmd: Command): void {
  cmd
    .command("list")
    .description("List environment variables")
    .option("--env-id <id>", "Environment ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { envId?: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const environmentId = normalizeOptionalCliInput(opts.envId, "Environment ID");
          const data = await trpc.environmentVariables.query({ environmentId });

          return ctx.success(data, {
            human: () => {
              console.log(
                chalk.bold(`\n  Environment Variables (${data.summary.totalVariables})\n`)
              );
              for (const v of data.variables) {
                const maskedSecret = v.isSecret && v.displayValue === "[secret]";
                const value = maskedSecret ? chalk.red("***secret***") : chalk.dim(v.displayValue);
                const cat = chalk.dim(`[${v.category}]`);
                console.log(`  ${chalk.cyan(v.key)} = ${value}  ${cat}`);
              }
              console.log();
            }
          });
        }
      });
    });
}

function registerEnvResolveCommand(cmd: Command): void {
  cmd
    .command("resolve")
    .description("Resolve all 1Password secret references for an environment")
    .requiredOption("--env-id <id>", "Environment ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { envId: string; json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const environmentId = normalizeCliInput(opts.envId, "Environment ID");
        const data = await trpc.resolveEnvironmentSecrets.query({ environmentId });

        if (data.variables.length === 0) {
          if (isJson) {
            emitJsonSuccess({
              environmentId,
              resolved: 0,
              unresolved: 0,
              variables: []
            });
          } else {
            console.log(chalk.dim("No 1Password references found in this environment."));
          }
          return;
        }

        if (isJson) {
          emitJsonSuccess({
            environmentId: data.environmentId,
            resolved: data.resolved,
            unresolved: data.unresolved,
            variables: data.variables
          });
          return;
        }

        console.log(chalk.bold(`\n  1Password References (${data.variables.length} variables)\n`));
        for (const variable of data.variables) {
          const status =
            variable.status === "resolved" ? chalk.green("resolved") : chalk.yellow("unresolved");
          const value = variable.maskedValue ? chalk.dim(variable.maskedValue) : chalk.red("n/a");
          console.log(
            `  ${chalk.cyan(variable.key)} → ${chalk.magenta(variable.secretRef)}  ${status}  ${value}`
          );
          console.log(
            chalk.dim(
              `    provider=${variable.providerName} source=${variable.source}${variable.error ? ` error=${variable.error}` : ""}`
            )
          );
        }
        console.log();
      } catch (err) {
        if (isJson) {
          emitJsonError(getErrorMessage(err), "API_ERROR");
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
      }
    });
}
