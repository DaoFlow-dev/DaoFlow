import { Command } from "commander";
import chalk from "chalk";
import { createClient } from "../trpc-client";

export function servicesCommand(): Command {
  return new Command("services")
    .description("List services and their status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const trpc = createClient();
      const data = await trpc.composeReleaseCatalog.query({});

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(chalk.bold("\n  Services\n"));

      if (!data.services?.length) {
        console.log(chalk.dim("  No services found.\n"));
        return;
      }

      const header = `  ${"SERVICE".padEnd(24)} ${"STATUS".padEnd(14)} ${"SERVER".padEnd(20)} ${"IMAGE".padEnd(30)}`;
      console.log(chalk.dim(header));
      console.log(chalk.dim("  " + "─".repeat(90)));

      for (const svc of data.services) {
        const statusColor =
          svc.status === "completed"
            ? chalk.green
            : svc.status === "failed"
              ? chalk.red
              : chalk.yellow;

        console.log(
          `  ${svc.serviceName.padEnd(24)} ${statusColor(svc.status.padEnd(14))} ${(svc.targetServerName ?? "").padEnd(20)} ${(svc.imageTag ?? "—").padEnd(30)}`
        );
      }
      console.log();
    });
}
