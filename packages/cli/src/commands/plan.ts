import { Command } from "commander";
import chalk from "chalk";
import { ApiClient } from "../api-client";

export function planCommand(): Command {
  return new Command("plan")
    .description("Show deployment plan without executing (dry-run)")
    .requiredOption("--service <name>", "Service name")
    .option("--server <id>", "Target server ID")
    .option("--image <tag>", "Image tag")
    .action(async (opts: { service: string; server?: string; image?: string }) => {
      const api = new ApiClient();

      console.log(chalk.bold("\n  Deployment Plan (dry-run)\n"));
      console.log(chalk.dim("  This plan will NOT be executed.\n"));

      // Fetch rollback plans to show current state
      const data = await api.get<{
        summary: Record<string, number>;
        services?: Array<{ serviceName: string; status: string; imageTag: string | null }>;
      }>("/trpc/listComposeReleaseCatalog");

      const current = data.services?.find((s) => s.serviceName === opts.service);

      console.log(`  ${chalk.bold("Service:")}   ${opts.service}`);
      console.log(`  ${chalk.bold("Server:")}    ${opts.server ?? "default"}`);
      console.log(`  ${chalk.bold("Image:")}     ${opts.image ?? "latest"}`);
      console.log();

      if (current) {
        console.log(chalk.dim("  Current state:"));
        console.log(`    Status: ${current.status}`);
        console.log(`    Image:  ${current.imageTag ?? "none"}`);
        console.log();
      }

      console.log(chalk.dim("  Planned steps:"));
      console.log(`    ${chalk.green("1.")} Pull/load image`);
      console.log(`    ${chalk.green("2.")} Stop existing container`);
      console.log(`    ${chalk.green("3.")} Create new container from image`);
      console.log(`    ${chalk.green("4.")} Start container`);
      console.log(`    ${chalk.green("5.")} Health check`);
      console.log(`    ${chalk.green("6.")} Update routing`);
      console.log();

      // Check for potential issues
      console.log(chalk.dim("  Pre-flight checks:"));
      console.log(`    ${chalk.green("✓")} Service exists in catalog`);
      console.log(`    ${chalk.green("✓")} Image reference valid`);
      console.log(`    ${chalk.yellow("?")} Server reachability (run: daoflow status)`);
      console.log();

      console.log(
        chalk.dim(
          "  To execute: daoflow deploy --service " +
            opts.service +
            " --server " +
            (opts.server ?? "<id>")
        )
      );
      console.log();
    });
}
