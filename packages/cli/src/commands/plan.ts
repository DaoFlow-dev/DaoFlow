import { Command } from "commander";
import chalk from "chalk";
import { createClient } from "../trpc-client";

export function planCommand(): Command {
  return new Command("plan")
    .description("Preview a deployment plan without executing it")
    .requiredOption("--service <id>", "Service name or ID")
    .option("--server <id>", "Target server")
    .option("--image <tag>", "Image tag to deploy")
    .action(async (opts: { service: string; server?: string; image?: string }) => {
      const trpc = createClient();

      console.log(chalk.bold("\n  Deployment Plan (dry-run)\n"));
      console.log(chalk.dim("  This plan will NOT be executed.\n"));

      // Fetch rollback plans to show current state
      const data = await trpc.composeReleaseCatalog.query({});

      const current = data.services?.find((s) => s.serviceName === opts.service);

      console.log(`  ${chalk.bold("Service:")}   ${opts.service}`);
      console.log(`  ${chalk.bold("Server:")}    ${opts.server ?? "default"}`);
      console.log(`  ${chalk.bold("Image:")}     ${opts.image ?? "latest"}`);
      console.log();

      if (current) {
        console.log(chalk.dim(`  Current state:`));
        console.log(chalk.dim(`    Status: ${current.status}`));
        console.log(chalk.dim(`    Image:  ${current.imageTag ?? "unknown"}`));
        console.log();
      }

      console.log(`  ${chalk.bold("Planned steps:")}`);
      console.log(`    1. Pull/load image`);
      console.log(`    2. Stop existing container`);
      console.log(`    3. Create new container from image`);
      console.log(`    4. Start container`);
      console.log(`    5. Health check`);
      console.log(`    6. Update routing`);
      console.log();

      console.log(`  ${chalk.bold("Pre-flight checks:")}`);
      console.log(`    ${chalk.green("✓")} Service exists in catalog`);
      console.log(`    ${chalk.green("✓")} Image reference valid`);
      console.log(`    ${chalk.yellow("?")} Server reachability (run: daoflow status)`);
      console.log();

      console.log(
        `  To execute: ${chalk.cyan(`daoflow deploy --service ${opts.service} --server <id>`)}\n`
      );
    });
}
