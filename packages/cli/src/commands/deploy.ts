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
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createClient } from "../trpc-client";
import { ApiClient, ApiError } from "../api-client";
import { loadDaoflowConfig, parseSizeString, type DaoflowConfig } from "../config-loader";
import { createContextBundle, detectLocalBuildContexts } from "../context-bundler";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
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

  // ── Dry-run ──────────────────────────────────────────────
  if (opts.dryRun) {
    const plan: Record<string, unknown> = {
      type: "compose",
      composePath: opts.composePath,
      context: opts.contextPath,
      server: opts.serverId,
      localBuildContexts: localContexts,
      requiresContextUpload: hasLocalContext,
      steps: [
        hasLocalContext ? "bundle local context (respects .dockerignore)" : null,
        hasLocalContext ? "upload context to DaoFlow server" : null,
        hasLocalContext ? "SCP context to target server" : null,
        "docker compose up -d --build",
        "health check"
      ].filter(Boolean)
    };

    // If local context, show bundle preview
    if (hasLocalContext) {
      try {
        const bundle = createContextBundle({
          contextPath: resolvedContext,
          extraIgnore: (opts.config as Record<string, unknown>)?.ignore as string[] | undefined,
          extraInclude: (opts.config as Record<string, unknown>)?.include as string[] | undefined,
          maxSizeBytes: (opts.config as Record<string, unknown>)?.maxContextSize
            ? parseSizeString((opts.config as Record<string, unknown>).maxContextSize as string)
            : undefined
        });

        const sizeMB = (bundle.sizeBytes / 1024 / 1024).toFixed(1);
        plan.contextBundle = {
          fileCount: bundle.fileCount,
          size: `${sizeMB}MB`,
          includedOverrides: bundle.includedOverrides
        };

        // Cleanup temp tar
        try {
          unlinkSync(bundle.tarPath);
        } catch {
          /* best-effort */
        }
      } catch (err) {
        plan.contextBundleError = err instanceof Error ? err.message : String(err);
      }
    }

    if (opts.json) {
      emitJsonSuccess({ dryRun: true, plan });
    } else {
      console.log(chalk.bold("\n  Compose Deployment Plan (dry-run)\n"));
      console.log(`  Compose:  ${opts.composePath}`);
      console.log(`  Context:  ${opts.contextPath}`);
      console.log(`  Server:   ${opts.serverId}`);
      console.log(
        `  Upload:   ${hasLocalContext ? chalk.yellow("yes (local build context)") : chalk.green("no (pre-built images)")}`
      );

      if (localContexts.length > 0) {
        console.log(chalk.bold("\n  Local Build Contexts:"));
        for (const ctx of localContexts) {
          console.log(
            `    ${chalk.cyan(ctx.serviceName)}  context=${ctx.context}  dockerfile=${ctx.dockerfile ?? "Dockerfile"}`
          );
        }
      }

      const bundleInfo = plan.contextBundle as
        | { fileCount: number; size: string; includedOverrides: string[] }
        | undefined;
      if (bundleInfo) {
        console.log(chalk.bold("\n  Context Bundle:"));
        console.log(`    Files:     ${bundleInfo.fileCount}`);
        console.log(`    Size:      ${bundleInfo.size}`);
        if (bundleInfo.includedOverrides.length > 0) {
          console.log(`    Overrides: ${chalk.yellow(bundleInfo.includedOverrides.join(", "))}`);
        }
      }

      console.log(chalk.bold("\n  Steps:"));
      for (const step of plan.steps as string[]) {
        console.log(`    ${chalk.dim("→")} ${step}`);
      }
      console.log();
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
    if (hasLocalContext) {
      await executeContextDeploy(resolvedCompose, resolvedContext, composeContent, opts);
    } else {
      await executeRemoteComposeDeploy(composeContent, opts);
    }
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

function executeContextDeploy(
  _composePath: string,
  contextPath: string,
  composeContent: string,
  opts: ComposeDeployOpts
): Promise<void> {
  return uploadContextBundle(contextPath, composeContent, opts);
}

function executeRemoteComposeDeploy(
  composeContent: string,
  opts: ComposeDeployOpts
): Promise<void> {
  const api = new ApiClient();
  return api
    .post<{
      ok: boolean;
      deploymentId: string;
    }>("/api/v1/deploy/compose", {
      server: opts.serverId,
      compose: composeContent,
      project: deriveProjectName(opts.composePath, composeContent)
    })
    .then((response) => {
      renderQueuedDeployment(response.deploymentId, opts);
    })
    .catch((error) => {
      throw normalizeDeployError(error);
    });
}

async function uploadContextBundle(
  contextPath: string,
  composeContent: string,
  opts: ComposeDeployOpts
): Promise<void> {
  const bundle = createContextBundle({
    contextPath,
    extraIgnore: (opts.config as Record<string, unknown>)?.ignore as string[] | undefined,
    extraInclude: (opts.config as Record<string, unknown>)?.include as string[] | undefined,
    maxSizeBytes: (opts.config as Record<string, unknown>)?.maxContextSize
      ? parseSizeString((opts.config as Record<string, unknown>).maxContextSize as string)
      : undefined
  });

  const api = new ApiClient();

  try {
    const response = (await api.streamUpload(
      "/api/v1/deploy",
      createReadStream(bundle.tarPath),
      statSync(bundle.tarPath).size,
      {
        contentType: "application/gzip",
        headers: {
          "X-DaoFlow-Server": opts.serverId ?? "",
          "X-DaoFlow-Compose": Buffer.from(composeContent, "utf8").toString("base64"),
          "X-DaoFlow-Project": deriveProjectName(opts.composePath, composeContent)
        }
      }
    )) as { ok: boolean; deploymentId: string };

    renderQueuedDeployment(response.deploymentId, opts);
  } catch (error) {
    throw normalizeDeployError(error);
  } finally {
    try {
      unlinkSync(bundle.tarPath);
    } catch {
      /* best-effort */
    }
  }
}

function deriveProjectName(composePath: string, composeContent: string): string {
  const namedMatch = composeContent.match(/^\s*name\s*:\s*["']?([^"'#\n]+)["']?\s*$/m);
  if (namedMatch?.[1]) {
    return namedMatch[1].trim();
  }

  const fileName = basename(composePath).replace(/\.(ya?ml)$/i, "");
  return fileName || "uploaded-compose";
}

function normalizeDeployError(error: unknown): Error {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body) as { error?: string };
      return new Error(body.error ?? error.message);
    } catch {
      return new Error(error.body || error.message);
    }
  }

  return error instanceof Error ? error : new Error(String(error));
}

function renderQueuedDeployment(deploymentId: string, opts: ComposeDeployOpts): void {
  if (opts.json) {
    emitJsonSuccess({ deploymentId, serverId: opts.serverId ?? null });
    return;
  }

  console.log(chalk.green("✓ Deployment queued"));
  console.log(chalk.dim(`  ID: ${deploymentId}`));
  console.log(chalk.dim(`  Server: ${opts.serverId}`));
}

function estimateContextSize(contextPath: string, cfg?: Record<string, unknown>): string {
  try {
    const bundle = createContextBundle({
      contextPath,
      extraIgnore: cfg?.ignore as string[] | undefined,
      extraInclude: cfg?.include as string[] | undefined
    });
    const sizeMB = (bundle.sizeBytes / 1024 / 1024).toFixed(1);
    try {
      unlinkSync(bundle.tarPath);
    } catch {
      /* best-effort */
    }
    return `${sizeMB}MB, ${bundle.fileCount} files`;
  } catch {
    return "unknown size";
  }
}
