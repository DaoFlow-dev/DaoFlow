import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { createClient } from "../trpc-client";
import { upsertEnvFileValue } from "../local-env";

export function envCommand(): Command {
  const cmd = new Command("env").description("Manage environment variables");

  cmd
    .command("pull")
    .description("Download .env from DaoFlow to local filesystem")
    .option("--env-id <id>", "Environment ID")
    .option("--output <path>", "Output file path", ".env")
    .option("--json", "Output as JSON")
    .action(async (opts: { envId?: string; output: string; json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const data = await trpc.environmentVariables.query({ environmentId: opts.envId });
        const lines = data.variables.map((v) =>
          v.isSecret ? `# ${v.key}=<secret>` : `${v.key}=${v.displayValue}`
        );
        const maskedSecretCount = data.variables.filter((v) => v.isSecret).length;

        writeFileSync(opts.output, lines.join("\n") + "\n");

        if (isJson) {
          emitJsonSuccess({
            environmentId: opts.envId ?? null,
            output: opts.output,
            variableCount: data.variables.length,
            maskedSecretCount
          });
          return;
        }

        console.log(chalk.green(`✓ Wrote ${data.variables.length} variables to ${opts.output}`));
        console.log(chalk.dim(`  (${maskedSecretCount} secrets masked)`));
      } catch (error) {
        if (isJson) {
          emitJsonError(getErrorMessage(error), "API_ERROR");
        } else {
          console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
        }
        process.exit(1);
      }
    });

  cmd
    .command("push")
    .description("Upload local .env to DaoFlow (encrypted)")
    .requiredOption("--env-id <id>", "Environment ID")
    .option("--input <path>", "Input .env file", ".env")
    .option("--secret", "Mark all variables as secret")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Preview what would be pushed")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          envId: string;
          input: string;
          secret?: boolean;
          yes?: boolean;
          dryRun?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (!existsSync(opts.input)) {
          const error = `File not found: ${opts.input}`;
          if (isJson) {
            emitJsonError(error, "FILE_NOT_FOUND");
          } else {
            console.error(chalk.red(`✗ ${error}`));
          }
          process.exit(1);
          return;
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
          if (isJson) {
            emitJsonSuccess({
              dryRun: true,
              environmentId: opts.envId,
              input: opts.input,
              variableCount: vars.length,
              keys: vars.map((v) => v.key),
              markAsSecret: opts.secret ?? false
            });
            process.exit(3);
          }

          console.log(chalk.bold(`\n  Dry-run: ${vars.length} variables from ${opts.input}\n`));
          for (const v of vars) {
            console.log(`    ${v.key}=${opts.secret ? "***" : v.value.slice(0, 40)}`);
          }
          process.exit(3);
        }

        if (!opts.yes) {
          const error = `This will push ${vars.length} variables to environment ${opts.envId}. Pass --yes to confirm.`;
          if (isJson) {
            emitJsonError(error, "CONFIRMATION_REQUIRED");
          } else {
            console.error(chalk.yellow(error));
          }
          process.exit(1);
          return;
        }

        try {
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

          if (isJson) {
            emitJsonSuccess({
              environmentId: opts.envId,
              input: opts.input,
              variableCount: count,
              markAsSecret: opts.secret ?? false
            });
            return;
          }

          console.log(chalk.green(`✓ Pushed ${count} variables to environment ${opts.envId}`));
        } catch (error) {
          if (isJson) {
            emitJsonError(getErrorMessage(error), "API_ERROR");
          } else {
            console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
          }
          process.exit(1);
        }
      }
    );

  // ── daoflow env list ──────────────────────────────────────
  cmd
    .command("list")
    .description("List environment variables")
    .option("--env-id <id>", "Environment ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { envId?: string; json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const data = await trpc.environmentVariables.query({ environmentId: opts.envId });

        if (isJson) {
          emitJsonSuccess(data);
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
        if (isJson) {
          emitJsonError(getErrorMessage(err), "API_ERROR");
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
      }
    });

  // ── daoflow env set ──────────────────────────────────────
  cmd
    .command("set")
    .description("Set an environment variable in DaoFlow or a local .env file")
    .option("--env-id <id>", "Environment ID (required unless --local)")
    .requiredOption("--key <key>", "Variable key")
    .option("--value <value>", "Variable value (required unless --secret-ref is used)")
    .option("--secret-ref <uri>", "1Password secret reference (op://vault/item/field)")
    .option("--secret", "Mark as secret (encrypted at rest)")
    .option("--category <cat>", "Category: runtime, build, secret", "runtime")
    .option("--local", "Write to a local .env file instead of the DaoFlow API")
    .option("--file <path>", "Local .env file path when using --local", ".env")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (
        opts: {
          envId?: string;
          key: string;
          value?: string;
          secretRef?: string;
          secret?: boolean;
          category: string;
          local?: boolean;
          file: string;
          json?: boolean;
          yes?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        // Validate: must have either --value or --secret-ref
        if (!opts.value && !opts.secretRef) {
          const msg = "Either --value or --secret-ref is required.";
          if (isJson) {
            emitJsonError(msg, "INVALID_INPUT");
          } else {
            console.error(chalk.red(`✗ ${msg}`));
          }
          process.exit(1);
        }

        if (!opts.local && !opts.envId) {
          const msg = "Environment ID is required unless --local is used.";
          if (isJson) {
            emitJsonError(msg, "INVALID_INPUT");
          } else {
            console.error(chalk.red(`✗ ${msg}`));
          }
          process.exit(1);
        }

        // Validate op:// URI format
        if (opts.secretRef && !/^op:\/\/[^/]+\/[^/]+\/[^/]+$/.test(opts.secretRef)) {
          const msg = `Invalid secret reference: ${opts.secretRef}. Expected format: op://vault/item/field`;
          if (isJson) {
            emitJsonError(msg, "INVALID_SECRET_REF");
          } else {
            console.error(chalk.red(`✗ ${msg}`));
          }
          process.exit(1);
        }

        if (opts.local) {
          try {
            const storedValue = opts.secretRef ? `[1password:${opts.secretRef}]` : opts.value!;
            upsertEnvFileValue(opts.file, opts.key, storedValue);

            if (isJson) {
              emitJsonSuccess({
                key: opts.key,
                file: opts.file,
                source: opts.secretRef ? "1password" : "inline"
              });
            } else {
              console.log(chalk.green(`✓ Wrote ${opts.key} to ${opts.file}`));
            }
          } catch (err) {
            if (isJson) {
              emitJsonError(getErrorMessage(err), "FILE_WRITE_FAILED");
            } else {
              console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
            }
            process.exit(1);
          }
          return;
        }

        if (!opts.yes) {
          const source = opts.secretRef ? ` (1Password: ${opts.secretRef})` : "";
          const error = `Set ${opts.key} in environment ${opts.envId}${source}. Pass --yes to confirm.`;
          if (isJson) {
            emitJsonError(error, "CONFIRMATION_REQUIRED");
          } else {
            console.error(chalk.yellow(error));
          }
          process.exit(1);
          return;
        }

        try {
          const trpc = createClient();
          await trpc.upsertEnvironmentVariable.mutate({
            environmentId: opts.envId!,
            key: opts.key,
            value: opts.secretRef ? `[1password:${opts.secretRef}]` : opts.value!,
            isSecret: opts.secret ?? !!opts.secretRef,
            category: opts.category as "runtime" | "build",
            source: opts.secretRef ? "1password" : "inline",
            secretRef: opts.secretRef ?? null
          });

          if (isJson) {
            emitJsonSuccess({
              key: opts.key,
              environment: opts.envId!,
              source: opts.secretRef ? "1password" : "inline",
              secretRef: opts.secretRef ?? null
            });
          } else {
            if (opts.secretRef) {
              console.log(
                chalk.green(
                  `✓ Set ${opts.key} → ${chalk.cyan(opts.secretRef)} in environment ${opts.envId}`
                )
              );
            } else {
              console.log(chalk.green(`✓ Set ${opts.key} in environment ${opts.envId!}`));
            }
          }
        } catch (err) {
          if (isJson) {
            emitJsonError(getErrorMessage(err), "API_ERROR");
          } else {
            console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
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
    .action(
      async (
        opts: { envId: string; key: string; json?: boolean; yes?: boolean },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (!opts.yes) {
          const error = `Destructive: delete ${opts.key} from environment ${opts.envId}. Pass --yes.`;
          if (isJson) {
            emitJsonError(error, "CONFIRMATION_REQUIRED");
          } else {
            console.error(chalk.yellow(error));
          }
          process.exit(1);
          return;
        }

        try {
          const trpc = createClient();
          await trpc.deleteEnvironmentVariable.mutate({
            environmentId: opts.envId,
            key: opts.key
          });

          if (isJson) {
            emitJsonSuccess({ deleted: opts.key, environment: opts.envId });
          } else {
            console.log(chalk.green(`✓ Deleted ${opts.key} from environment ${opts.envId}`));
          }
        } catch (err) {
          if (isJson) {
            emitJsonError(getErrorMessage(err), "API_ERROR");
          } else {
            console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
          }
          process.exit(1);
        }
      }
    );

  // ── daoflow env resolve ─────────────────────────────────
  cmd
    .command("resolve")
    .description("Resolve all 1Password secret references for an environment")
    .requiredOption("--env-id <id>", "Environment ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { envId: string; json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const data = await trpc.resolveEnvironmentSecrets.query({ environmentId: opts.envId });

        if (data.variables.length === 0) {
          if (isJson) {
            emitJsonSuccess({
              environmentId: opts.envId,
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
        } else {
          console.log(
            chalk.bold(`\n  1Password References (${data.variables.length} variables)\n`)
          );
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
        }
      } catch (err) {
        if (isJson) {
          emitJsonError(getErrorMessage(err), "API_ERROR");
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}
