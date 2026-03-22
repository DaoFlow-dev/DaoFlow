import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { upsertEnvFileValue } from "../local-env";
import { createClient } from "../trpc-client";

interface EnvSetResult {
  key: string;
  source: "1password" | "inline";
  file?: string;
  environment?: string;
  secretRef?: string | null;
}

export function registerEnvSetCommand(cmd: Command): void {
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
}

export function registerEnvDeleteCommand(cmd: Command): void {
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
}
