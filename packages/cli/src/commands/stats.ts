import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { ApiClient } from "../api-client";

interface ContainerStats {
  containerName?: string;
  cpuPercent?: number;
  memoryUsageMb?: number;
  memoryLimitMb?: number;
  memoryPercent?: number;
  networkRxMb?: number;
  networkTxMb?: number;
  blockReadMb?: number;
  blockWriteMb?: number;
}

export function statsCommand(): Command {
  return new Command("stats")
    .description("Show container resource usage (CPU, memory, network)")
    .requiredOption("--service <id>", "Service ID")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  diagnostics:read

Examples:
  daoflow stats --service svc_123 --json
`
    )
    .action(async (opts: { service: string; json?: boolean }, command: Command) => {
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
          const data = await api.get<ContainerStats>(
            `/api/v1/container-stats/${encodeURIComponent(opts.service)}`
          );

          return ctx.success(data, {
            human: () => {
              console.log(chalk.bold("\n  Container Stats\n"));
              if (data.containerName) console.log(`  Container: ${data.containerName}`);
              if (data.cpuPercent !== undefined) console.log(`  CPU: ${data.cpuPercent}%`);
              if (data.memoryUsageMb !== undefined) {
                const memPct = data.memoryPercent !== undefined ? ` (${data.memoryPercent}%)` : "";
                console.log(
                  `  Memory: ${data.memoryUsageMb}MB / ${data.memoryLimitMb ?? "?"}MB${memPct}`
                );
              }
              if (data.networkRxMb !== undefined) {
                console.log(`  Network: ↓ ${data.networkRxMb}MB  ↑ ${data.networkTxMb ?? 0}MB`);
              }
              if (data.blockReadMb !== undefined) {
                console.log(`  Disk: R ${data.blockReadMb}MB  W ${data.blockWriteMb ?? 0}MB`);
              }
              console.log();
            }
          });
        }
      });
    });
}
