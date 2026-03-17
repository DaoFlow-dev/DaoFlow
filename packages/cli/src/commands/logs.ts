import { Command } from "commander";
import chalk from "chalk";
import { createClient } from "../trpc-client";

export function logsCommand(): Command {
  return new Command("logs")
    .description("Stream real-time deployment logs (SSE)")
    .argument("[service]", "Service name to filter")
    .option("--deployment <id>", "Deployment ID")
    .option("--follow", "Follow log output", false)
    .option("--lines <n>", "Number of lines to show", "50")
    .action(
      async (
        service: string | undefined,
        opts: { deployment?: string; follow?: boolean; lines?: string }
      ) => {
        if (opts.follow) {
          // SSE streaming endpoint not yet implemented on the server
          console.error(
            chalk.yellow(
              "Log streaming (--follow) is not yet implemented. Use without --follow for historical logs."
            )
          );
          process.exit(1);
        } else {
          const trpc = createClient();
          const data = await trpc.deploymentLogs.query({
            deploymentId: opts.deployment,
            limit: Number(opts.lines),
          });

          for (const line of data.lines) {
            const ts = chalk.dim(line.createdAt.slice(11, 23));
            const level = line.stream === "stderr" ? chalk.red("ERR") : chalk.blue("OUT");
            console.log(`${ts} ${level} ${line.message}`);
          }
        }
      }
    );
}
