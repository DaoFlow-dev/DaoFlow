import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { ApiClient } from "../api-client";

interface ServerMetricsSnapshot {
  cpuPercent: number;
  memoryUsedPercent: number;
  memoryUsedGB: number;
  memoryTotalGB: number;
  diskUsedPercent: number;
  diskTotalGB: number;
  networkInMB: number;
  networkOutMB: number;
}

function bar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
  return color("[" + "#".repeat(filled) + "-".repeat(empty) + "]") + ` ${pct.toFixed(1)}%`;
}

export function serverMetricsCommand(): Command {
  return new Command("server-metrics")
    .description("Show host-level server metrics (CPU, memory, disk, network)")
    .requiredOption("--server <id>", "Server ID")
    .option("--live", "Collect fresh metrics (slower, ~2s)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  diagnostics:read

Examples:
  daoflow server-metrics --server srv_abc123
  daoflow server-metrics --server srv_abc123 --live
  daoflow server-metrics --server srv_abc123 --json
`
    )
    .action(async (opts: { server: string; live?: boolean; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const currentContext = getCurrentContext();
          if (!currentContext) {
            return ctx.fail("Not logged in. Run `daoflow login` first.", {
              code: "NOT_LOGGED_IN"
            });
          }

          const api = new ApiClient();
          const query = opts.live ? "?live=true" : "";
          const data = await api.get<ServerMetricsSnapshot>(
            `/api/v1/server-metrics/${encodeURIComponent(opts.server)}${query}`
          );

          return ctx.success(data, {
            human: () => {
              console.log(chalk.bold("\n  Server Metrics\n"));
              console.log(`  CPU:    ${bar(data.cpuPercent)}`);
              console.log(
                `  Memory: ${bar(data.memoryUsedPercent)}  ${data.memoryUsedGB.toFixed(1)} / ${data.memoryTotalGB.toFixed(1)} GB`
              );
              console.log(
                `  Disk:   ${bar(data.diskUsedPercent)}  ${data.diskTotalGB.toFixed(0)} GB total`
              );
              console.log(
                `  Network: ${chalk.cyan("↓")} ${data.networkInMB.toFixed(1)} MB  ${chalk.cyan("↑")} ${data.networkOutMB.toFixed(1)} MB`
              );
              console.log();
            }
          });
        }
      });
    });
}
