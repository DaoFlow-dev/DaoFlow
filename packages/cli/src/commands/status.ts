import { Command } from "commander";
import chalk from "chalk";
import {
  getErrorMessage,
  resolveCommandJsonOption,
  withResolvedCommandRequestOptions
} from "../command-helpers";
import { createClient, type RouterOutputs } from "../trpc-client";
import { getCurrentContext, loadConfig } from "../config";

function formatServerRuntime(check: RouterOutputs["serverReadiness"]["checks"][number]): string {
  const latency = check.latencyMs === null ? "latency n/a" : `${check.latencyMs}ms`;
  return `Docker ${check.dockerVersion ?? "unavailable"} · Compose ${check.composeVersion ?? "unavailable"} · ${latency} · checked ${check.checkedAt}`;
}

function formatSwarmTopology(
  topology: NonNullable<RouterOutputs["serverReadiness"]["checks"][number]["swarmTopology"]>
): string {
  return `${topology.clusterName} · ${topology.summary.managerCount} manager${topology.summary.managerCount === 1 ? "" : "s"} · ${topology.summary.workerCount} worker${topology.summary.workerCount === 1 ? "" : "s"} · ${topology.summary.nodeCount} nodes`;
}

export function statusCommand(): Command {
  return new Command("status")
    .description("Show current deployment and server status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const config = loadConfig();
      const ctx = getCurrentContext();

      if (!ctx) {
        if (isJson) {
          console.log(JSON.stringify({ ok: false, error: "Not logged in", code: "NOT_LOGGED_IN" }));
        } else {
          console.log(
            chalk.yellow("  Not logged in. Run: daoflow login --url <url> --token <token>")
          );
        }
        process.exit(1);
      }

      await withResolvedCommandRequestOptions(command, async () => {
        const trpc = createClient(ctx);

        try {
          const [servers, health] = await Promise.allSettled([
            trpc.serverReadiness.query({}),
            trpc.health.query()
          ]);

          const serverData: RouterOutputs["serverReadiness"] | null =
            servers.status === "fulfilled" ? servers.value : null;
          const healthData: RouterOutputs["health"] | null =
            health.status === "fulfilled" ? health.value : null;

          if (isJson) {
            console.log(
              JSON.stringify({
                ok: true,
                data: {
                  context: config.currentContext,
                  apiUrl: ctx.apiUrl,
                  health: healthData,
                  servers: serverData
                }
              })
            );
          } else {
            console.log(chalk.bold("\n  DaoFlow Status\n"));
            console.log(`  Context:  ${chalk.cyan(config.currentContext)}`);
            console.log(`  API URL:  ${ctx.apiUrl}`);
            console.log(
              `  Health:   ${healthData ? chalk.green("● healthy") : chalk.yellow("● unknown")}`
            );
            console.log();

            if (serverData) {
              console.log(chalk.bold("  Servers"));
              console.log(
                `  Total: ${serverData.summary.totalServers}  Ready: ${chalk.green(serverData.summary.readyServers)}  Attention: ${chalk.yellow(serverData.summary.attentionServers)}  Poll: ${Math.round(serverData.summary.pollIntervalMs / 1000)}s`
              );
              if (serverData.summary.averageLatencyMs !== null) {
                console.log(`  Average latency: ${serverData.summary.averageLatencyMs}ms`);
              }
              console.log();

              for (const check of serverData.checks) {
                const icon =
                  check.readinessStatus === "ready" ? chalk.green("●") : chalk.yellow("●");
                console.log(
                  `  ${icon} ${check.serverName.padEnd(20)} ${check.serverHost}  ${check.readinessStatus}`
                );
                console.log(chalk.dim(`    ${formatServerRuntime(check)}`));
                console.log(
                  `    SSH ${check.sshReachable ? "ok" : "blocked"} · Docker ${check.dockerReachable ? "ok" : "blocked"} · Compose ${check.composeReachable ? "ok" : "blocked"}`
                );
                if (check.swarmTopology) {
                  console.log(chalk.dim(`    Swarm ${formatSwarmTopology(check.swarmTopology)}`));
                }
                if (check.issues.length > 0) {
                  console.log(chalk.yellow(`    Issues: ${check.issues.join("; ")}`));
                }
              }
            }

            console.log();
          }
        } catch (err) {
          if (isJson) {
            console.log(
              JSON.stringify({
                ok: false,
                error: getErrorMessage(err),
                code: "API_ERROR"
              })
            );
          } else {
            console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
          }
          process.exit(1);
        }
      });
    });
}
