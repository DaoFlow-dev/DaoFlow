import { Command } from "commander";
import chalk from "chalk";
import { getErrorMessage, resolveCommandJsonOption } from "../command-helpers";
import { createClient } from "../trpc-client";

export function logsCommand(): Command {
  return new Command("logs")
    .description("Stream real-time deployment logs (SSE)")
    .argument("[service]", "Service name to filter")
    .option("--deployment <id>", "Deployment ID")
    .option("--follow", "Follow log output", false)
    .option("--lines <n>", "Number of lines to show", "50")
    .option("--json", "Output as JSON")
    .action(
      async (
        service: string | undefined,
        opts: { deployment?: string; follow?: boolean; lines?: string; json?: boolean },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (opts.follow) {
          const error =
            "Log streaming (--follow) is not yet implemented. Use without --follow for historical logs.";
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error, code: "NOT_IMPLEMENTED" }));
          } else {
            console.error(chalk.yellow(error));
          }
          process.exit(1);
          return;
        }

        try {
          const trpc = createClient();
          const data = await trpc.deploymentLogs.query({
            deploymentId: opts.deployment,
            limit: Number(opts.lines)
          });

          if (isJson) {
            console.log(
              JSON.stringify({
                ok: true,
                data: {
                  service: service ?? null,
                  deploymentId: opts.deployment ?? null,
                  limit: Number(opts.lines),
                  lines: data.lines
                }
              })
            );
            return;
          }

          for (const line of data.lines) {
            const ts = chalk.dim(line.createdAt.slice(11, 23));
            const level = line.stream === "stderr" ? chalk.red("ERR") : chalk.blue("OUT");
            console.log(`${ts} ${level} ${line.message}`);
          }
        } catch (error) {
          if (isJson) {
            console.log(
              JSON.stringify({
                ok: false,
                error: getErrorMessage(error),
                code: "API_ERROR"
              })
            );
          } else {
            console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
          }
          process.exit(1);
        }
      }
    );
}
