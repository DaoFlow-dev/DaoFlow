import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiClient } from "../api-client";

export function pushCommand(): Command {
  return new Command("push")
    .description("Build and push a local Docker image to DaoFlow (no registry needed)")
    .option("--tag <tag>", "Docker image tag", "daoflow-app:latest")
    .option("--dockerfile <path>", "Dockerfile path", "Dockerfile")
    .option("--context <path>", "Build context", ".")
    .option("--server <id>", "Target server ID")
    .option("--service <name>", "Service name")
    .option("--skip-build", "Skip docker build, push existing image")
    .action(
      async (opts: {
        tag: string;
        dockerfile: string;
        context: string;
        server?: string;
        service?: string;
        skipBuild?: boolean;
      }) => {
        const api = new ApiClient();
        const tag: string = opts.tag;
        const tarPath = join(tmpdir(), `daoflow-push-${Date.now()}.tar.gz`);

        // Step 1: Build image locally
        if (!opts.skipBuild) {
          console.log(chalk.blue(`⟳ Building Docker image ${tag}...`));
          try {
            execSync(`docker build -t ${tag} -f ${opts.dockerfile} ${opts.context}`, {
              stdio: "inherit"
            });
            console.log(chalk.green(`✓ Image built: ${tag}`));
          } catch {
            console.error(chalk.red("✗ Docker build failed"));
            process.exit(1);
          }
        }

        // Step 2: Save image to compressed tarball
        console.log(chalk.blue("⟳ Compressing image..."));
        try {
          execSync(`docker save ${tag} | gzip > ${tarPath}`, { stdio: "inherit" });
          const size = statSync(tarPath).size;
          const sizeMB = (size / 1024 / 1024).toFixed(1);
          console.log(chalk.green(`✓ Saved ${sizeMB} MB`));
        } catch {
          console.error(chalk.red("✗ Failed to save Docker image"));
          process.exit(1);
        }

        // Step 3: Stream tarball to DaoFlow API
        console.log(chalk.blue("⟳ Pushing image to DaoFlow..."));
        const fileSize = statSync(tarPath).size;
        const stream = createReadStream(tarPath);

        try {
          const result = await api.streamUpload(
            `/api/v1/images/push?tag=${encodeURIComponent(tag)}&server=${encodeURIComponent(opts.server ?? "")}&service=${encodeURIComponent(opts.service ?? "")}`,
            stream as unknown as ReadableStream,
            fileSize
          );

          console.log(chalk.green("✓ Image pushed successfully"));
          console.log(chalk.dim(JSON.stringify(result, null, 2)));
        } catch (err: unknown) {
          console.error(chalk.red(`✗ Push failed: ${String(err)}`));
          process.exit(1);
        }

        // Cleanup
        try {
          execSync(`rm -f ${tarPath}`);
        } catch {
          /* ignore */
        }
      }
    );
}
