import { Command } from "commander";
import chalk from "chalk";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { ApiClient } from "../api-client";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";

export function pushCommand(): Command {
  return new Command("push")
    .description("Build and push a local Docker image to DaoFlow (no registry needed)")
    .option("--tag <tag>", "Docker image tag", "daoflow-app:latest")
    .option("--dockerfile <path>", "Dockerfile path", "Dockerfile")
    .option("--context <path>", "Build context", ".")
    .option("--server <id>", "Target server ID")
    .option("--service <name>", "Service name")
    .option("--skip-build", "Skip docker build, push existing image")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          tag: string;
          dockerfile: string;
          context: string;
          server?: string;
          service?: string;
          skipBuild?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (!opts.yes) {
          const error = "This will build and push a Docker image. Pass --yes to confirm.";
          if (isJson) {
            emitJsonError(error, "CONFIRMATION_REQUIRED");
          } else {
            console.error(chalk.yellow(error));
          }
          process.exit(1);
          return;
        }
        const api = new ApiClient();
        const tag: string = opts.tag;
        const tarFile = join(tmpdir(), `daoflow-push-${Date.now()}.tar`);
        const tarPath = join(tmpdir(), `daoflow-push-${Date.now()}.tar.gz`);

        // Step 1: Build image locally
        if (!opts.skipBuild) {
          if (!isJson) console.log(chalk.blue(`⟳ Building Docker image ${tag}...`));
          try {
            runDockerCommand(["build", "-t", tag, "-f", opts.dockerfile, opts.context], !isJson);
            if (!isJson) console.log(chalk.green(`✓ Image built: ${tag}`));
          } catch (error) {
            if (isJson) {
              emitJsonError(getErrorMessage(error), "BUILD_FAILED");
            } else {
              console.error(chalk.red(`✗ Docker build failed: ${getErrorMessage(error)}`));
            }
            process.exit(1);
            return;
          }
        }

        if (!isJson) console.log(chalk.blue("⟳ Compressing image..."));
        try {
          runDockerCommand(["image", "save", "-o", tarFile, tag], !isJson);
          await gzipFile(tarFile, tarPath);
          const size = statSync(tarPath).size;
          if (!isJson) {
            const sizeMB = (size / 1024 / 1024).toFixed(1);
            console.log(chalk.green(`✓ Saved ${sizeMB} MB`));
          }
        } catch (error) {
          if (isJson) {
            emitJsonError(getErrorMessage(error), "SAVE_FAILED");
          } else {
            console.error(chalk.red(`✗ Failed to save Docker image: ${getErrorMessage(error)}`));
          }
          process.exit(1);
          return;
        }

        // Step 3: Stream tarball to DaoFlow API
        if (!isJson) console.log(chalk.blue("⟳ Pushing image to DaoFlow..."));
        const fileSize = statSync(tarPath).size;
        const stream = createReadStream(tarPath);

        try {
          const result = await api.streamUpload(
            `/api/v1/images/push?tag=${encodeURIComponent(tag)}&server=${encodeURIComponent(opts.server ?? "")}&service=${encodeURIComponent(opts.service ?? "")}`,
            stream as unknown as ReadableStream,
            fileSize
          );

          if (isJson) {
            emitJsonSuccess(result);
          } else {
            console.log(chalk.green("✓ Image pushed successfully"));
            console.log(chalk.dim(JSON.stringify(result, null, 2)));
          }
        } catch (err: unknown) {
          if (isJson) {
            emitJsonError(getErrorMessage(err), "PUSH_FAILED");
          } else {
            console.error(chalk.red(`✗ Push failed: ${getErrorMessage(err)}`));
          }
          process.exit(1);
          return;
        }

        // Cleanup
        try {
          unlinkSync(tarFile);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(tarPath);
        } catch {
          /* ignore */
        }
      }
    );
}

function runDockerCommand(args: string[], inheritOutput: boolean): void {
  const result = spawnSync("docker", args, {
    stdio: inheritOutput ? "inherit" : ["ignore", "pipe", "pipe"],
    encoding: inheritOutput ? undefined : "utf8"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    throw new Error(stderr || stdout || `docker ${args[0]} failed with exit code ${result.status}`);
  }
}

async function gzipFile(sourcePath: string, targetPath: string): Promise<void> {
  await pipeline(createReadStream(sourcePath), createGzip(), createWriteStream(targetPath));
}
