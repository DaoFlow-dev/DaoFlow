import { Command } from "commander";
import chalk from "chalk";
import { ApiClient } from "../api-client";
import { getCurrentContext, loadConfig } from "../config";

export function statusCommand(): Command {
  return new Command("status")
    .description("Show current deployment and server status")
    .option("--json", "Output as JSON")
    .action(async (_opts) => {
      // Show context info
      const config = loadConfig();
      const ctx = getCurrentContext();

      console.log(chalk.bold("\n  DaoFlow Status\n"));
      console.log(`  Context:  ${chalk.cyan(config.currentContext)}`);
      console.log(`  API URL:  ${ctx?.apiUrl ?? chalk.dim("not configured")}`);
      console.log();

      if (!ctx) {
        console.log(
          chalk.yellow("  Not logged in. Run: daoflow login --url <url> --token <token>")
        );
        return;
      }

      const api = new ApiClient(ctx);

      // Fetch server readiness
      try {
        const servers = await api.get<{
          summary: { totalServers: number; readyServers: number; attentionServers: number };
          checks: Array<{ serverName: string; serverHost: string; readinessStatus: string }>;
        }>("/trpc/listServerReadiness");

        console.log(chalk.bold("  Servers"));
        console.log(
          `  Total: ${servers.summary.totalServers}  Ready: ${chalk.green(servers.summary.readyServers)}  Attention: ${chalk.yellow(servers.summary.attentionServers)}`
        );
        console.log();

        for (const check of servers.checks) {
          const icon = check.readinessStatus === "ready" ? chalk.green("●") : chalk.yellow("●");
          console.log(`  ${icon} ${check.serverName.padEnd(20)} ${check.serverHost}`);
        }
      } catch {
        console.log(chalk.dim("  Unable to fetch server status"));
      }

      // Fetch recent deployments
      try {
        const deployments = await api.get<
          Array<{
            id: string;
            serviceName: string;
            status: string;
            createdAt: string;
          }>
        >("/trpc/listDeploymentRecords?input=" + encodeURIComponent(JSON.stringify({ limit: 5 })));

        console.log(chalk.bold("\n  Recent Deployments"));
        if (Array.isArray(deployments)) {
          for (const dep of deployments) {
            const statusColor =
              dep.status === "completed"
                ? chalk.green
                : dep.status === "failed"
                  ? chalk.red
                  : chalk.yellow;
            console.log(
              `  ${dep.id.slice(0, 8)}  ${dep.serviceName.padEnd(20)} ${statusColor(dep.status.padEnd(12))} ${chalk.dim(dep.createdAt)}`
            );
          }
        }
      } catch {
        console.log(chalk.dim("  Unable to fetch deployment status"));
      }

      console.log();
    });
}
