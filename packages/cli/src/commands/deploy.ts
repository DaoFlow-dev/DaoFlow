import { Command } from "commander";
import chalk from "chalk";
import { ApiClient, ApiError } from "../api-client";

export function deployCommand(): Command {
  return new Command("deploy")
    .description("Deploy a service")
    .requiredOption("--service <id>", "Service ID to deploy")
    .option("--commit <sha>", "Commit SHA to deploy")
    .option("--image <tag>", "Image tag to deploy")
    .option("--dry-run", "Preview deployment plan without executing")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (opts: {
        service: string;
        commit?: string;
        image?: string;
        dryRun?: boolean;
        yes?: boolean;
        json?: boolean;
      }) => {
        const isJson = opts.json;

        if (opts.dryRun) {
          const plan = {
            ok: true,
            dryRun: true,
            plan: {
              serviceId: opts.service,
              commitSha: opts.commit ?? null,
              imageTag: opts.image ?? null,
              steps: [
                "resolve service + environment",
                "pull/build image",
                "create network + volumes",
                "start containers",
                "health check"
              ]
            }
          };

          if (isJson) {
            console.log(JSON.stringify(plan));
          } else {
            console.log(chalk.bold("\n  Deployment Plan (dry-run)\n"));
            console.log(`  Service ID: ${opts.service}`);
            if (opts.commit) console.log(`  Commit:     ${opts.commit}`);
            if (opts.image) console.log(`  Image:      ${opts.image}`);
            console.log(`  Steps:`);
            for (const step of plan.plan.steps) {
              console.log(`    ${chalk.dim("→")} ${step}`);
            }
            console.log();
          }
          process.exit(3); // dry-run exit code per AGENTS.md §12
        }

        if (!opts.yes) {
          console.error(
            chalk.yellow(
              "Destructive operation. Pass --yes to confirm, or use --dry-run to preview."
            )
          );
          process.exit(1);
        }

        try {
          const api = new ApiClient();
          if (!isJson) {
            console.log(chalk.blue(`⟳ Deploying service ${opts.service}...`));
          }

          const result = await api.post<{
            id: string;
            status: string;
            serviceName: string;
          }>("/trpc/triggerDeploy", {
            json: {
              serviceId: opts.service,
              commitSha: opts.commit,
              imageTag: opts.image
            }
          });

          if (isJson) {
            console.log(JSON.stringify({ ok: true, data: result }));
          } else {
            console.log(chalk.green("✓ Deployment queued"));
            console.log(chalk.dim(`  ID: ${result.id}`));
            console.log(chalk.dim(`  Service: ${result.serviceName}`));
          }
        } catch (err) {
          if (err instanceof ApiError) {
            if (isJson) {
              console.log(
                JSON.stringify({
                  ok: false,
                  error: err.message,
                  code: err.statusCode === 403 ? "SCOPE_DENIED" : "API_ERROR",
                  requiredScope: err.statusCode === 403 ? "deploy:start" : undefined
                })
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
