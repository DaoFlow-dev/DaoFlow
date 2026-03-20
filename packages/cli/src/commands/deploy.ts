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
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { analyzeComposeInputs } from "../compose-input-analysis";
import { executeComposeDeploy, estimateContextSize } from "../compose-deploy-execution";
import { previewComposeDeploy } from "../compose-deploy-preview";
import type { ComposeDeployCoreOptions } from "../compose-deploy-types";
import {
  assertValidComposeUploadContextRoot,
  ComposeUploadContextValidationError
} from "../compose-upload-context";
import { previewServiceDeploy } from "../service-deploy-preview";
import { buildServicePreviewTarget } from "../service-preview-target";

const DEPLOY_HELP_TEXT = [
  "",
  "Target rules:",
  "  Provide exactly one of --service or --compose.",
  "  Compose deploys require --server.",
  "  Executing a deployment also requires --yes.",
  "",
  "Required scope:",
  "  --dry-run: deploy:read",
  "  execute: deploy:start",
  "",
  "Examples:",
  "  daoflow deploy --service svc_123 --dry-run --json",
  "  daoflow deploy --service svc_123 --yes",
  "  daoflow deploy --service svc_123 --preview-branch feature/login --dry-run",
  "  daoflow deploy --service svc_123 --preview-branch feature/login --preview-pr 42 --yes",
  "  daoflow deploy --compose ./compose.yaml --server srv_123 --dry-run --json",
  "  daoflow deploy --compose ./compose.yaml --server srv_123 --yes",
  "",
  "Example JSON shapes:",
  '  dry-run: { "ok": true, "data": { "dryRun": true, "plan": { ... } } }',
  '  service execute: { "ok": true, "data": { "id": "dep_123", "serviceName": "api", ... } }',
  '  compose execute: { "ok": true, "data": { "deploymentId": "dep_123", "serverId": "srv_123" } }'
].join("\n");

export function deployCommand(): Command {
  return new Command("deploy")
    .description("Deploy a service or compose project")
    .option("--service <id>", "Service ID to deploy")
    .option("--compose <path>", "Docker Compose file path")
    .option("--context <path>", "Upload root for compose-local inputs (default: .)")
    .option("--server <id>", "Target server ID")
    .option("--commit <sha>", "Commit SHA to deploy")
    .option("--image <tag>", "Image tag to deploy")
    .option("--preview-branch <branch>", "Target a compose preview for a source branch")
    .option("--preview-pr <number>", "Associate the preview with a pull request number")
    .option("--preview-close", "Destroy the targeted preview stack instead of deploying it")
    .option("--dry-run", "Preview deployment plan without executing")
    .option("--no-prompt", "Skip interactive prompts (for CI/agent use)")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText("after", DEPLOY_HELP_TEXT)
    .action(
      async (
        opts: {
          service?: string;
          compose?: string;
          context?: string;
          server?: string;
          commit?: string;
          image?: string;
          previewBranch?: string;
          previewPr?: string;
          previewClose?: boolean;
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
          console.error(chalk.dim(`  Using config: ${configResult.filePath}`));
        }

        // Merge config defaults with CLI flags
        const composePath = opts.compose ?? cfg?.compose;
        const contextPath = opts.context ?? cfg?.context ?? ".";
        const serverId = opts.server ?? cfg?.server;
        const serviceId = opts.service;
        const previewTargetResult = buildServicePreviewTarget({
          previewBranch: opts.previewBranch,
          previewPr: opts.previewPr,
          previewClose: opts.previewClose
        });
        if (previewTargetResult.error) {
          if (isJson) {
            emitJsonError(previewTargetResult.error, "INVALID_INPUT");
          } else {
            console.error(chalk.red(previewTargetResult.error));
          }
          process.exit(1);
          return;
        }
        const previewTarget = previewTargetResult.preview;

        // ── Route: Compose deploy (new) ──────────────────────
        if (composePath) {
          if (previewTarget) {
            const error = "Preview targeting is only supported with --service deployments.";
            if (isJson) {
              emitJsonError(error, "INVALID_INPUT");
            } else {
              console.error(chalk.red(error));
            }
            process.exit(1);
            return;
          }
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
              preview: previewTarget,
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
            imageTag: opts.image,
            preview: previewTarget
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

function buildComposeUploadWarning(input: {
  buildContextCount: number;
  buildSupportFileCount: number;
  envFileCount: number;
  sizeLabel: string;
  serverId: string;
}): string {
  const parts: string[] = [];

  if (input.buildContextCount > 0) {
    parts.push(
      `${input.buildContextCount} service(s) use local build context${
        input.buildContextCount === 1 ? "" : "s"
      }`
    );
  }

  if (input.buildSupportFileCount > 0) {
    parts.push(
      `${input.buildSupportFileCount} local build support file${
        input.buildSupportFileCount === 1 ? "" : "s"
      } will be frozen`
    );
  }

  if (input.envFileCount > 0) {
    parts.push(
      `${input.envFileCount} local env_file asset${input.envFileCount === 1 ? "" : "s"} will be frozen`
    );
  }

  return (
    `${parts.join(" and ")} (${input.sizeLabel}). ` +
    `Context will be bundled, uploaded to DaoFlow, and deployed on server ${input.serverId}. ` +
    `Pass --yes to confirm, or --dry-run to preview.`
  );
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

  // Parse compose and detect local inputs that require context artifacting.
  const composeContent = readFileSync(resolvedCompose, "utf-8");
  const composeInputs = analyzeComposeInputs(composeContent);

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

  try {
    assertValidComposeUploadContextRoot({
      composePath: resolvedCompose,
      contextPath: resolvedContext,
      composeInputs
    });
  } catch (err) {
    const message = getErrorMessage(err);
    if (opts.json) {
      emitJsonError(message, "INVALID_INPUT");
    } else {
      console.error(chalk.red(`✗ ${message}`));
    }
    process.exit(1);
    return;
  }

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
  if (composeInputs.requiresContextUpload && opts.prompt && !opts.yes) {
    const sizeMB = estimateContextSize(resolvedContext, opts.config as Record<string, unknown>);
    const error = buildComposeUploadWarning({
      buildContextCount: composeInputs.localBuildContexts.length,
      buildSupportFileCount: composeInputs.localBuildSupportFiles.length,
      envFileCount: composeInputs.localEnvFiles.length,
      sizeLabel: sizeMB,
      serverId: opts.serverId
    });
    if (opts.json) {
      emitJsonError(error, "CONFIRMATION_REQUIRED");
    } else {
      console.log(chalk.yellow(`\n⚠  ${error}\n`));
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
    await executeComposeDeploy(composeContent, composeInputs.requiresContextUpload, composeOptions);
  } catch (err) {
    if (err instanceof ComposeUploadContextValidationError) {
      if (opts.json) {
        emitJsonError(getErrorMessage(err), "INVALID_INPUT");
      } else {
        console.error(chalk.red(`✗ ${getErrorMessage(err)}`));
      }
      process.exit(1);
      return;
    }

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
