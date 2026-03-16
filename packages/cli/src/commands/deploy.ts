import { Command } from "commander";
import chalk from "chalk";
import { ApiClient, ApiError } from "../api-client";

export function deployCommand(): Command {
  return new Command("deploy")
    .description("Deploy a service from git/compose/dockerfile")
    .requiredOption("--service <name>", "Service name")
    .requiredOption("--server <id>", "Target server ID")
    .option("--source <type>", "Source type: compose | dockerfile | image", "compose")
    .option("--commit <sha>", "Commit SHA")
    .option("--image <tag>", "Image tag")
    .option("--env <id>", "Environment name", "production")
    .option("--project <name>", "Project name", "default")
    .option("--dry-run", "Preview deployment plan without executing")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(
      async (opts: {
        service: string;
        server: string;
        source: string;
        commit?: string;
        image?: string;
        env: string;
        project: string;
        dryRun?: boolean;
        yes?: boolean;
      }) => {
        const parentOpts = deployCommand().parent?.opts() ?? {};
        const isJson = parentOpts.json;

        if (opts.dryRun) {
          const plan = {
            ok: true,
            dryRun: true,
            plan: {
              service: opts.service,
              server: opts.server,
              source: opts.source,
              commit: opts.commit ?? null,
              image: opts.image ?? null,
              environment: opts.env,
              project: opts.project,
              steps: ["pull/build", "create network", "create volumes", "start containers", "health check"]
            }
          };

          if (isJson) {
            console.log(JSON.stringify(plan));
          } else {
            console.log(chalk.bold("\n  Deployment Plan (dry-run)\n"));
            console.log(`  Service:     ${opts.service}`);
            console.log(`  Server:      ${opts.server}`);
            console.log(`  Source:      ${opts.source}`);
            console.log(`  Environment: ${opts.env}`);
            console.log(`  Steps:`);
            for (const step of plan.plan.steps) {
              console.log(`    ${chalk.dim("→")} ${step}`);
            }
            console.log();
          }
          process.exit(3); // dry-run exit code
        }

        if (!opts.yes) {
          console.error(
            chalk.yellow("Destructive operation. Pass --yes to confirm, or use --dry-run to preview.")
          );
          process.exit(1);
        }

        try {
          const api = new ApiClient();
          if (!isJson) {
            console.log(chalk.blue(`⟳ Deploying ${opts.service}...`));
          }

          const result = await api.post("/trpc/createDeploymentRecord", {
            json: {
              serviceName: opts.service,
              targetServerId: opts.server,
              sourceType: opts.source,
              commitSha: opts.commit ?? "0000000",
              imageTag: opts.image ?? `${opts.service}:latest`,
              environmentName: opts.env,
              projectName: opts.project,
              steps: [
                { label: "Pull", detail: `Pull image for ${opts.service}` },
                { label: "Start", detail: `Start container on ${opts.server}` }
              ]
            }
          });

          if (isJson) {
            console.log(JSON.stringify({ ok: true, data: result }));
          } else {
            console.log(chalk.green("✓ Deployment queued"));
            console.log(chalk.dim(JSON.stringify(result, null, 2)));
          }
        } catch (err) {
          if (err instanceof ApiError) {
            if (isJson) {
              console.log(
                JSON.stringify({ ok: false, error: err.message, code: "API_ERROR" })
              );
            } else {
              console.error(chalk.red(`Error: ${err.message}`));
            }
            process.exit(err.exitCode);
          }
          throw err;
        }
      }
    );
}
