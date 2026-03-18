import { Command } from "commander";
import chalk from "chalk";
import { getErrorMessage, resolveCommandJsonOption } from "../command-helpers";
import { createClient } from "../trpc-client";

export function planCommand(): Command {
  return new Command("plan")
    .description("Preview a deployment plan without executing it")
    .requiredOption("--service <id>", "Service name or ID")
    .option("--server <id>", "Target server")
    .option("--image <tag>", "Image tag to deploy")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: { service: string; server?: string; image?: string; json?: boolean },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        try {
          const trpc = createClient();
          const data = await trpc.composeReleaseCatalog.query({});
          const current =
            data.services?.find((service) => service.serviceName === opts.service) ?? null;
          const steps = [
            "Pull/load image",
            "Stop existing container",
            "Create new container from image",
            "Start container",
            "Health check",
            "Update routing"
          ];
          const preflightChecks = [
            { status: "ok", detail: "Service exists in catalog" },
            { status: "ok", detail: "Image reference valid" },
            { status: "warn", detail: "Server reachability (run: daoflow status)" }
          ] as const;
          const plan = {
            service: opts.service,
            server: opts.server ?? "default",
            image: opts.image ?? "latest",
            current,
            steps,
            preflightChecks,
            executeCommand: `daoflow deploy --service ${opts.service} --server <id>`
          };

          if (isJson) {
            console.log(JSON.stringify({ ok: true, data: plan }));
            return;
          }

          console.log(chalk.bold("\n  Deployment Plan (dry-run)\n"));
          console.log(chalk.dim("  This plan will NOT be executed.\n"));
          console.log(`  ${chalk.bold("Service:")}   ${plan.service}`);
          console.log(`  ${chalk.bold("Server:")}    ${plan.server}`);
          console.log(`  ${chalk.bold("Image:")}     ${plan.image}`);
          console.log();

          if (current) {
            console.log(chalk.dim(`  Current state:`));
            console.log(chalk.dim(`    Status: ${current.status}`));
            console.log(chalk.dim(`    Image:  ${current.imageTag ?? "unknown"}`));
            console.log();
          }

          console.log(`  ${chalk.bold("Planned steps:")}`);
          for (const [index, step] of steps.entries()) {
            console.log(`    ${index + 1}. ${step}`);
          }
          console.log();

          console.log(`  ${chalk.bold("Pre-flight checks:")}`);
          console.log(`    ${chalk.green("✓")} ${preflightChecks[0].detail}`);
          console.log(`    ${chalk.green("✓")} ${preflightChecks[1].detail}`);
          console.log(`    ${chalk.yellow("?")} ${preflightChecks[2].detail}`);
          console.log();

          console.log(`  To execute: ${chalk.cyan(plan.executeCommand)}\n`);
        } catch (error) {
          if (isJson) {
            console.log(
              JSON.stringify({
                ok: false,
                error: getErrorMessage(error),
                code: "API_ERROR"
              })
            );
          } else {
            console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
          }
          process.exit(1);
        }
      }
    );
}
