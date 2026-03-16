import { Command } from "commander";
import chalk from "chalk";
import { ApiClient, ApiError } from "../api-client";
import { getCurrentContext, loadConfig } from "../config";

export function statusCommand(): Command {
  return new Command("status")
    .description("Show current deployment and server status")
    .action(async () => {
      const parentOpts = statusCommand().parent?.opts() ?? {};
      const isJson = parentOpts.json;
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

      const api = new ApiClient(ctx);

      try {
        const [servers, health] = await Promise.allSettled([
          api.get<{
            summary: { totalServers: number; readyServers: number; attentionServers: number };
            checks: Array<{
              serverName: string;
              serverHost: string;
              readinessStatus: string;
              sshReachable: boolean;
              dockerReachable: boolean;
            }>;
          }>("/trpc/serverReadiness"),
          api.get<{ status: string; timestamp: string }>("/trpc/health")
        ]);

        const serverData = servers.status === "fulfilled" ? servers.value : null;
        const healthData = health.status === "fulfilled" ? health.value : null;

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
              `  Total: ${serverData.summary.totalServers}  Ready: ${chalk.green(serverData.summary.readyServers)}  Attention: ${chalk.yellow(serverData.summary.attentionServers)}`
            );
            console.log();

            for (const check of serverData.checks) {
              const icon = check.sshReachable ? chalk.green("●") : chalk.yellow("●");
              console.log(
                `  ${icon} ${check.serverName.padEnd(20)} ${check.serverHost}  Docker: ${check.dockerReachable ? "✓" : "✗"}`
              );
            }
          }

          console.log();
        }
      } catch (err) {
        if (err instanceof ApiError) {
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error: err.message, code: "API_ERROR" }));
          } else {
            console.error(chalk.red(`Error: ${err.message}`));
          }
          process.exit(err.exitCode);
        }
        throw err;
      }
    });
}
