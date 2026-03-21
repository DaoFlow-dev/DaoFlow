import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
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
import { upsertEnvFileValue } from "../local-env";

interface EnvSetResult {
  key: string;
  source: "1password" | "inline";
  file?: string;
  environment?: string;
  secretRef?: string | null;
}

export function envCommand(): Command {
  const cmd = new Command("env").description("Manage environment variables");

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
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            if (!existsSync(opts.input)) {
              ctx.fail(`File not found: ${opts.input}`, { code: "FILE_NOT_FOUND" });
            }

            const environmentId = normalizeCliInput(opts.envId, "Environment ID");
            const inputPath = normalizeCliInput(opts.input, "Input path", {
              allowPathTraversal: true,
              maxLength: 1024
            });
            const content = readFileSync(inputPath, "utf-8");
            const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
            const vars: { key: string; value: string }[] = [];

            for (const line of lines) {
              const eqIdx = line.indexOf("=");
              if (eqIdx < 0) continue;
              vars.push({
                key: normalizeCliInput(line.slice(0, eqIdx), "Environment key"),
                value: normalizeCliInput(line.slice(eqIdx + 1), "Environment value", {
                  allowPathTraversal: true,
                  allowShellMetacharacters: true,
                  maxLength: 4096
                })
              });
            }

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  environmentId,
                  input: inputPath,
                  variableCount: vars.length,
                  keys: vars.map((v) => v.key),
                  markAsSecret: opts.secret ?? false
                },
                {
                  human: () => {
                    console.log(
                      chalk.bold(`\n  Dry-run: ${vars.length} variables from ${opts.input}\n`)
                    );
                    for (const v of vars) {
                      console.log(`    ${v.key}=${opts.secret ? "***" : v.value.slice(0, 40)}`);
                    }
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `This will push ${vars.length} variables to environment ${environmentId}. Pass --yes to confirm.`,
              {
                humanMessage: `This will push ${vars.length} variables to environment ${environmentId}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            let count = 0;
            for (const v of vars) {
              await trpc.upsertEnvironmentVariable.mutate({
                environmentId,
                key: v.key,
                value: v.value,
                isSecret: opts.secret ?? false,
                category: "runtime"
              });
              count++;
            }

            return ctx.success(
              {
                environmentId,
                input: inputPath,
                variableCount: count,
                markAsSecret: opts.secret ?? false
              },
              {
                human: () => {
                  console.log(
                    chalk.green(`✓ Pushed ${count} variables to environment ${environmentId}`)
                  );
                }
              }
            );
          }
        });
      }
    );

  // ── daoflow env list ──────────────────────────────────────
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
        await runCommandAction<EnvSetResult>({
          command,
          json: opts.json,
          action: async (ctx) => {
            if (!opts.value && !opts.secretRef) {
              ctx.fail("Either --value or --secret-ref is required.", { code: "INVALID_INPUT" });
            }

            if (!opts.local && !opts.envId) {
              ctx.fail("Environment ID is required unless --local is used.", {
                code: "INVALID_INPUT"
              });
            }

            const key = normalizeCliInput(opts.key, "Environment key");
            const value = normalizeOptionalCliInput(opts.value, "Environment value", {
              allowPathTraversal: true,
              allowShellMetacharacters: true,
              maxLength: 4096
            });
            const environmentId = opts.local
              ? undefined
              : normalizeOptionalCliInput(opts.envId, "Environment ID");
            const filePath = normalizeCliInput(opts.file, "Environment file path", {
              allowPathTraversal: true,
              maxLength: 1024
            });
            const secretRef = normalizeOptionalCliInput(opts.secretRef, "Secret reference", {
              allowPathTraversal: true,
              maxLength: 512
            });

            if (secretRef && !/^op:\/\/[^/]+\/[^/]+\/[^/]+$/.test(secretRef)) {
              ctx.fail(
                `Invalid secret reference: ${secretRef}. Expected format: op://vault/item/field`,
                { code: "INVALID_SECRET_REF" }
              );
            }

            if (opts.local) {
              const storedValue = secretRef ? `[1password:${secretRef}]` : value!;
              try {
                upsertEnvFileValue(filePath, key, storedValue);
              } catch (err) {
                ctx.fail(getErrorMessage(err), { code: "FILE_WRITE_FAILED" });
              }

              return ctx.success(
                {
                  key,
                  file: filePath,
                  source: secretRef ? "1password" : "inline"
                },
                {
                  quiet: () => key,
                  human: () => {
                    console.log(chalk.green(`✓ Wrote ${key} to ${filePath}`));
                  }
                }
              );
            }

            const source = secretRef ? ` (1Password: ${secretRef})` : "";
            ctx.requireConfirmation(
              opts.yes === true,
              `Set ${key} in environment ${environmentId}${source}. Pass --yes to confirm.`
            );

            const trpc = createClient();
            await trpc.upsertEnvironmentVariable.mutate({
              environmentId: environmentId!,
              key,
              value: secretRef ? `[1password:${secretRef}]` : value!,
              isSecret: opts.secret ?? !!secretRef,
              category: opts.category as "runtime" | "build",
              source: secretRef ? "1password" : "inline",
              secretRef: secretRef ?? null
            });

            return ctx.success(
              {
                key,
                environment: environmentId!,
                source: secretRef ? "1password" : "inline",
                secretRef: secretRef ?? null
              },
              {
                quiet: () => key,
                human: () => {
                  if (secretRef) {
                    console.log(
                      chalk.green(
                        `✓ Set ${key} → ${chalk.cyan(secretRef)} in environment ${environmentId}`
                      )
                    );
                  } else {
                    console.log(chalk.green(`✓ Set ${key} in environment ${environmentId!}`));
                  }
                }
              }
            );
          }
        });
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
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            const environmentId = normalizeCliInput(opts.envId, "Environment ID");
            const key = normalizeCliInput(opts.key, "Environment key");
            ctx.requireConfirmation(
              opts.yes === true,
              `Destructive: delete ${key} from environment ${environmentId}. Pass --yes.`,
              {
                humanMessage: `Destructive: delete ${key} from environment ${environmentId}. Pass --yes.`
              }
            );

            const trpc = createClient();
            await trpc.deleteEnvironmentVariable.mutate({
              environmentId,
              key
            });

            return ctx.success(
              { deleted: key, environment: environmentId },
              {
                quiet: () => key,
                human: () => {
                  console.log(chalk.green(`✓ Deleted ${key} from environment ${environmentId}`));
                }
              }
            );
          }
        });
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
