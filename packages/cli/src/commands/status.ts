import { Command } from "commander";
import chalk from "chalk";
import { getErrorMessage, resolveCommandJsonOption } from "../command-helpers";
import { createClient, type RouterOutputs } from "../trpc-client";
import { getCurrentContext, loadConfig } from "../config";

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
}
