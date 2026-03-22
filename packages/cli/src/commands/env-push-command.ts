import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

export function registerEnvPushCommand(cmd: Command): void {
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
            const vars = readEnvFileVariables(inputPath);

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
}

function readEnvFileVariables(inputPath: string): Array<{ key: string; value: string }> {
  const content = readFileSync(inputPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
  const vars: Array<{ key: string; value: string }> = [];

  for (const line of lines) {
    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) {
      continue;
    }

    vars.push({
      key: normalizeCliInput(line.slice(0, eqIdx), "Environment key"),
      value: normalizeCliInput(line.slice(eqIdx + 1), "Environment value", {
        allowPathTraversal: true,
        allowShellMetacharacters: true,
        maxLength: 4096
      })
    });
  }

  return vars;
}
