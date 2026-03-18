/**
 * deploy.ts — Deploy a service or compose project.
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   deploy → command lane, deploy:start
 *
 * Supports two modes:
 *   1. Service deploy: --service <id> (working path)
 *   2. Compose deploy: --compose <path> (direct upload or context bundle)
 */

import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "../trpc-client";
import { loadDaoflowConfig, type DaoflowConfig } from "../config-loader";
import { detectLocalBuildContexts } from "../context-bundler";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { executeComposeDeploy, estimateContextSize } from "../compose-deploy-execution";
import { previewComposeDeploy } from "../compose-deploy-preview";
import type { ComposeDeployCoreOptions } from "../compose-deploy-types";
import { previewServiceDeploy } from "../service-deploy-preview";

export function deployCommand(): Command {
  return new Command("deploy")
    .description("Deploy a service or compose project")
    .option("--service <id>", "Service ID to deploy")
    .option("--compose <path>", "Docker Compose file path")
    .option("--context <path>", "Build context path (default: .)")
    .option("--server <id>", "Target server ID")
    .option("--commit <sha>", "Commit SHA to deploy")
    .option("--image <tag>", "Image tag to deploy")
    .option("--dry-run", "Preview deployment plan without executing")
    .option("--no-prompt", "Skip interactive prompts (for CI/agent use)")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          service?: string;
          compose?: string;
          context?: string;
          server?: string;
          commit?: string;
          image?: string;
          dryRun?: boolean;
          prompt?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        // ── Load config defaults ─────────────────────────────
        const configResult = loadDaoflowConfig();
        const cfg = configResult?.config;
        if (configResult && !isJson) {
          console.log(chalk.dim(`  Using config: ${configResult.filePath}`));
        }

        // Merge config defaults with CLI flags
        const composePath = opts.compose ?? cfg?.compose;
        const contextPath = opts.context ?? cfg?.context ?? ".";
        const serverId = opts.server ?? cfg?.server;
        const serviceId = opts.service;

        // ── Route: Compose deploy (new) ──────────────────────
        if (composePath) {
          await handleComposeDeploy({
            composePath,
            contextPath,
            serverId,
            dryRun: opts.dryRun,
            prompt: opts.prompt !== false,
            yes: opts.yes,
            json: isJson,
            config: cfg
          });
          return;
        }

        // ── Route: Service deploy (existing) ─────────────────
        if (!serviceId) {
          const error = "Either --service or --compose is required.";
          if (isJson) {
            emitJsonError(error, "INVALID_INPUT");
          } else {
            console.error(chalk.red(error));
            console.error(chalk.dim("  daoflow deploy --service <id> --yes"));
            console.error(
              chalk.dim("  daoflow deploy --compose ./compose.yaml --server <id> --yes")
            );
          }
          process.exit(1);
          return;
        }

        if (opts.dryRun) {
          try {
            const trpc = createClient();
            await previewServiceDeploy(trpc, {
              serviceId,
              serverId,
              imageTag: opts.image,
              json: isJson
            });
          } catch (err) {
            if (isJson) {
              emitJsonError(getErrorMessage(err), "API_ERROR");
            } else {
              console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
            }
            process.exit(1);
            return;
          }

          process.exit(3); // dry-run exit code per AGENTS.md §12
        }

        if (!opts.yes) {
          const error =
            "Destructive operation. Pass --yes to confirm, or use --dry-run to preview.";
          if (isJson) {
            emitJsonError(error, "CONFIRMATION_REQUIRED");
          } else {
            console.error(chalk.yellow(error));
          }
          process.exit(1);
          return;
        }

        try {
          const trpc = createClient();
          if (!isJson) {
            console.log(chalk.blue(`⟳ Deploying service ${serviceId}...`));
          }

          const result = await trpc.triggerDeploy.mutate({
            serviceId,
            commitSha: opts.commit,
            imageTag: opts.image
          });

          if (isJson) {
            emitJsonSuccess(result);
          } else {
            console.log(chalk.green("✓ Deployment queued"));
            console.log(chalk.dim(`  ID: ${result.id}`));
            console.log(chalk.dim(`  Service: ${result.serviceName}`));
          }
        } catch (err) {
          if (isJson) {
            emitJsonError(getErrorMessage(err), "API_ERROR");
          } else {
            console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
          }
          process.exit(1);
        }
      }
    );
}

// ── Compose Deploy Handler ─────────────────────────────────────

interface ComposeDeployOpts {
  composePath: string;
  contextPath: string;
  serverId?: string;
  dryRun?: boolean;
  prompt: boolean;
  yes?: boolean;
  json?: boolean;
  config?: DaoflowConfig;
}

async function handleComposeDeploy(opts: ComposeDeployOpts): Promise<void> {
  const resolvedCompose = resolve(opts.composePath);
  const resolvedContext = resolve(opts.contextPath);

  // Validate compose file exists
  if (!existsSync(resolvedCompose)) {
    const error = `Compose file not found: ${opts.composePath}`;
    if (opts.json) {
      emitJsonError(error, "FILE_NOT_FOUND");
    } else {
      console.error(chalk.red(`✗ ${error}`));
    }
    process.exit(1);
    return;
  }

  // Parse compose and detect local build contexts
  const composeContent = readFileSync(resolvedCompose, "utf-8");
  const localContexts = detectLocalBuildContexts(composeContent);

  const hasLocalContext = localContexts.some(
    (c) => c.context === "." || c.context.startsWith("./") || !c.context.includes(":")
  );

  if (!opts.serverId) {
    const error = "--server is required for compose deployments.";
    if (opts.json) {
      emitJsonError(error, "INVALID_INPUT");
    } else {
      console.error(chalk.red(`✗ ${error}`));
    }
    process.exit(1);
    return;
  }

  const composeOptions: ComposeDeployCoreOptions = {
    composePath: opts.composePath,
    contextPath: opts.contextPath,
    serverId: opts.serverId,
    json: opts.json,
    config: opts.config
  };

  // ── Dry-run ──────────────────────────────────────────────
  if (opts.dryRun) {
    try {
      const trpc = createClient();
      await previewComposeDeploy(trpc, composeOptions);
    } catch (err) {
      if (opts.json) {
        emitJsonError(getErrorMessage(err), "API_ERROR");
      } else {
        console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
      }
      process.exit(1);
      return;
    }

    process.exit(3);
  }

  // ── Interactive prompt ───────────────────────────────────
  if (hasLocalContext && opts.prompt && !opts.yes) {
    const sizeMB = estimateContextSize(resolvedContext, opts.config as Record<string, unknown>);
    const error =
      `${localContexts.length} service(s) use local build context (${sizeMB}). ` +
      `Context will be bundled, uploaded to DaoFlow, and built on server ${opts.serverId}. ` +
      `Pass --yes to confirm, or --dry-run to preview.`;
    if (opts.json) {
      emitJsonError(error, "CONFIRMATION_REQUIRED");
    } else {
      console.log(
        chalk.yellow(
          `\n⚠  ${localContexts.length} service(s) use local build context (${sizeMB}).\n` +
            `   Context will be bundled, uploaded to DaoFlow, and built on server ${opts.serverId}.\n` +
            `   Pass --yes to confirm, or --dry-run to preview.\n`
        )
      );
    }
    process.exit(1);
    return;
  }

  if (!opts.yes) {
    const error = "Destructive operation. Pass --yes to confirm, or use --dry-run to preview.";
    if (opts.json) {
      emitJsonError(error, "CONFIRMATION_REQUIRED");
    } else {
      console.error(chalk.yellow(error));
    }
    process.exit(1);
    return;
  }

  // ── Execute compose deploy ───────────────────────────────
  try {
    await executeComposeDeploy(composeContent, hasLocalContext, composeOptions);
  } catch (err) {
    if (opts.json) {
      emitJsonError(getErrorMessage(err), "DEPLOY_ERROR");
    } else {
      console.error(
        chalk.red(`✗ Deployment failed: ${err instanceof Error ? err.message : String(err)}`)
      );
    }
    process.exit(1);
  }
}
