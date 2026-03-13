import { Command } from "commander";
import chalk from "chalk";
import { ApiClient } from "../api-client";

export function deployCommand(): Command {
  return new Command("deploy")
    .description("Deploy a service from git/compose/dockerfile")
    .requiredOption("--service <name>", "Service name")
    .requiredOption("--server <id>", "Target server ID")
    .option("--source <type>", "Source type: compose | dockerfile | image", "compose")
    .option("--commit <sha>", "Commit SHA")
    .option("--image <tag>", "Image tag")
    .option("--env <id>", "Environment ID")
    .action(async (opts) => {
      const api = new ApiClient();
      console.log(chalk.blue(`⟳ Deploying ${opts.service}...`));

      const result = await api.post("/trpc/createDeployment", {
        serviceName: opts.service,
        targetServerId: opts.server,
        sourceType: opts.source,
        commitSha: opts.commit ?? "",
        imageTag: opts.image ?? "",
        environmentName: opts.env ?? "production",
        projectName: "default"
      });

      console.log(chalk.green(`✓ Deployment queued`));
      console.log(chalk.dim(JSON.stringify(result, null, 2)));
    });
}
