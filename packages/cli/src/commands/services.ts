import { Command } from "commander";
import chalk from "chalk";
import {
  getErrorMessage,
  resolveCommandJsonOption,
  withResolvedCommandRequestOptions
} from "../command-helpers";
import { createClient } from "../trpc-client";
function colorizeTone(tone: string, value: string) {
  if (tone === "healthy") {
    return chalk.green(value);
  }

  if (tone === "failed") {
    return chalk.red(value);
  }

  if (tone === "running") {
    return chalk.yellow(value);
  }

  return chalk.dim(value);
}

export function servicesCommand(): Command {
  return new Command("services")
    .description("List services and their runtime status")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Filter by project ID")
    .action(async (opts: { json?: boolean; project?: string }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      await withResolvedCommandRequestOptions(command, async () => {
        try {
          const trpc = createClient();
          const services = opts.project
            ? await trpc.projectServices.query({ projectId: opts.project })
            : await trpc.services.query({});

          if (isJson) {
            console.log(
              JSON.stringify({ ok: true, data: { projectId: opts.project ?? null, services } })
            );
            return;
          }

          console.log(chalk.bold("\n  Services\n"));

          if (!services.length) {
            console.log(chalk.dim("  No services found.\n"));
            return;
          }

          const header = `  ${"SERVICE".padEnd(22)} ${"RUNTIME".padEnd(18)} ${"STRATEGY".padEnd(20)} ${"SERVER".padEnd(18)} ${"IMAGE".padEnd(28)}`;
          console.log(chalk.dim(header));
          console.log(chalk.dim("  " + "─".repeat(112)));

          for (const svc of services) {
            const runtimeLabel = svc.runtimeSummary.statusLabel.padEnd(18);
            const targetServer = svc.latestDeployment?.targetServerName ?? "—";
            const imageRef = svc.latestDeployment?.imageTag ?? svc.imageReference ?? "—";

            console.log(
              `  ${svc.name.padEnd(22)} ${colorizeTone(svc.runtimeSummary.statusTone, runtimeLabel)} ${svc.rolloutStrategy.label.padEnd(20)} ${targetServer.padEnd(18)} ${imageRef.padEnd(28)}`
            );
            console.log(chalk.dim(`    ${svc.runtimeSummary.summary}`));
            console.log(
              chalk.dim(
                `    Strategy: ${svc.rolloutStrategy.summary} Downtime risk: ${svc.rolloutStrategy.downtimeRisk}.`
              )
            );
          }
          console.log();
        } catch (error) {
          if (isJson) {
            console.log(
              JSON.stringify({ ok: false, error: getErrorMessage(error), code: "API_ERROR" })
            );
          } else {
            console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
          }
          process.exit(1);
        }
      });
    });
}
