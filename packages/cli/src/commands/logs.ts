import { Command } from "commander";
import chalk from "chalk";
import { ApiClient } from "../api-client";

export function logsCommand(): Command {
  return new Command("logs")
    .description("Stream real-time deployment logs (SSE)")
    .argument("[service]", "Service name to filter")
    .option("--deployment <id>", "Deployment ID")
    .option("--follow", "Follow log output", false)
    .option("--lines <n>", "Number of lines to show", "50")
    .action(async (service, opts) => {
      const api = new ApiClient();

      if (opts.follow) {
        // SSE streaming mode
        console.log(chalk.dim("Streaming logs (Ctrl+C to stop)...\n"));
        const abort = new AbortController();
        process.on("SIGINT", () => {
          abort.abort();
          process.exit(0);
        });

        const path = opts.deployment
          ? `/api/v1/logs/stream?deployment=${opts.deployment}`
          : `/api/v1/logs/stream${service ? `?service=${service}` : ""}`;

        await api.sse(
          path,
          (data) => {
            try {
              const log = JSON.parse(data);
              const ts = chalk.dim(new Date().toISOString().slice(11, 23));
              const level =
                log.level === "error"
                  ? chalk.red("ERR")
                  : log.level === "warn"
                    ? chalk.yellow("WRN")
                    : chalk.blue("INF");
              console.log(`${ts} ${level} ${log.message}`);
            } catch {
              console.log(data);
            }
          },
          abort.signal
        );
      } else {
        // Historical mode
        const params = new URLSearchParams();
        if (opts.deployment) params.set("deploymentId", opts.deployment);

        const data = await api.get<{
          lines: Array<{ createdAt: string; level: string; message: string; stream: string }>;
        }>(
          `/trpc/listDeploymentLogs?input=${encodeURIComponent(JSON.stringify({ deploymentId: opts.deployment, limit: Number(opts.lines) }))}`
        );

        for (const line of data.lines) {
          const ts = chalk.dim(line.createdAt.slice(11, 23));
          const level = line.stream === "stderr" ? chalk.red("ERR") : chalk.blue("OUT");
          console.log(`${ts} ${level} ${line.message}`);
        }
      }
    });
}
