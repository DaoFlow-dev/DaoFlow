import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { ApiClient } from "../api-client";

export function envCommand(): Command {
  const cmd = new Command("env").description("Manage environment variables");

  cmd
    .command("pull")
    .description("Download .env from DaoFlow to local filesystem")
    .option("--env-id <id>", "Environment ID")
    .option("--output <path>", "Output file path", ".env")
    .action(async (opts) => {
      const api = new ApiClient();
      const data = await api.get<{
        variables: Array<{ key: string; displayValue: string; isSecret: boolean }>;
      }>(`/trpc/listEnvironmentVariableInventory?input=${encodeURIComponent(JSON.stringify({ environmentId: opts.envId }))}`);

      const lines = data.variables.map((v) =>
        v.isSecret ? `# ${v.key}=<secret>` : `${v.key}=${v.displayValue}`
      );

      writeFileSync(opts.output, lines.join("\n") + "\n");
      console.log(chalk.green(`✓ Wrote ${data.variables.length} variables to ${opts.output}`));
      console.log(chalk.dim(`  (${data.variables.filter(v => v.isSecret).length} secrets masked)`));
    });

  cmd
    .command("push")
    .description("Upload local .env to DaoFlow (encrypted)")
    .requiredOption("--env-id <id>", "Environment ID")
    .option("--input <path>", "Input .env file", ".env")
    .option("--secret", "Mark all variables as secret")
    .action(async (opts) => {
      const api = new ApiClient();

      if (!existsSync(opts.input)) {
        console.error(chalk.red(`✗ File not found: ${opts.input}`));
        process.exit(1);
      }

      const content = readFileSync(opts.input, "utf-8");
      const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#"));
      let count = 0;

      for (const line of lines) {
        const eqIdx = line.indexOf("=");
        if (eqIdx < 0) continue;
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();

        await api.post("/trpc/upsertEnvironmentVariable", {
          environmentId: opts.envId,
          key,
          value,
          isSecret: opts.secret ?? false,
          category: "runtime"
        });
        count++;
      }

      console.log(chalk.green(`✓ Pushed ${count} variables to environment ${opts.envId}`));
    });

  return cmd;
}
