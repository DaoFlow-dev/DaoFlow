import { Command, Option } from "commander";
import chalk from "chalk";
import {
  getErrorMessage,
  resolveCommandJsonOption,
  withResolvedCommandRequestOptions
} from "../command-helpers";
import { createClient } from "../trpc-client";

export function logsCommand(): Command {
  return new Command("logs")
    .description("Fetch persisted deployment logs from the control plane")
    .argument("[service]", "Service name to filter when querying recent logs")
    .option("--deployment <id>", "Deployment ID")
    .option("--query <text>", "Search within persisted log messages")
    .option("--follow", "Follow log output", false)
    .option("--lines <n>", "Number of lines to show", "50")
    .addOption(
      new Option("--stream <stream>", "Filter by stream")
        .choices(["all", "stdout", "stderr"])
        .default("all")
    )
    .option("--json", "Output as JSON")
    .action(
      async (
        service: string | undefined,
        opts: {
          deployment?: string;
          query?: string;
          follow?: boolean;
          lines?: string;
          stream?: "all" | "stdout" | "stderr";
          json?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);
        await withResolvedCommandRequestOptions(command, async () => {
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
              service,
              query: opts.query,
              stream: opts.stream,
              limit: Number(opts.lines)
            });

            if (isJson) {
              console.log(
                JSON.stringify({
                  ok: true,
                  data: {
                    service: service ?? null,
                    deploymentId: opts.deployment ?? null,
                    query: opts.query ?? null,
                    stream: opts.stream ?? "all",
                    limit: Number(opts.lines),
                    summary: data.summary,
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
        });
      }
    );
}
