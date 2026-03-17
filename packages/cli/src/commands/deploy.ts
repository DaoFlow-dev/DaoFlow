/**
 * deploy.ts — Deploy a service or compose project.
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   deploy → command lane, deploy:start
 *
 * Supports two modes:
 *   1. Service deploy: --service <id> (existing behavior)
 *   2. Compose deploy: --compose <path> (new: bundles local context)
 *
 * When --compose is used with a local build context, the CLI:
 *   1. Detects services with build.context: .
 *   2. Prompts for confirmation (unless --no-prompt)
 *   3. Bundles context as tar.gz (respects .dockerignore + .daoflowignore)
 *   4. Uploads to DaoFlow server via POST /api/v1/deploy/context
 *   5. Server SCP's context to target server, builds remotely
 */

import { Command } from "commander";
import chalk from "chalk";
import { createReadStream, readFileSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "../trpc-client";
import { getCurrentContext } from "../config";
import { loadDaoflowConfig, parseSizeString } from "../config-loader";
import { createContextBundle, detectLocalBuildContexts } from "../context-bundler";

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
      async (opts: {
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
      }) => {
        const isJson = opts.json;

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
            config: cfg,
          });
          return;
        }

        // ── Route: Service deploy (existing) ─────────────────
        if (!serviceId) {
          console.error(chalk.red("Either --service or --compose is required."));
          console.error(chalk.dim("  daoflow deploy --service <id> --yes"));
          console.error(chalk.dim("  daoflow deploy --compose ./compose.yaml --server <id> --yes"));
          process.exit(1);
        }

        if (opts.dryRun) {
          const plan = {
            ok: true,
            dryRun: true,
            plan: {
              serviceId,
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
            console.log(`  Service ID: ${serviceId}`);
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
            console.log(JSON.stringify({ ok: true, data: result }));
          } else {
            console.log(chalk.green("✓ Deployment queued"));
            console.log(chalk.dim(`  ID: ${result.id}`));
            console.log(chalk.dim(`  Service: ${result.serviceName}`));
          }
        } catch (err) {
          if (isJson) {
            console.log(
              JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : "Unknown error",
                code: "API_ERROR"
              })
            );
          } else {
            console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
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
  config?: ReturnType<typeof loadDaoflowConfig> extends infer R
    ? R extends { config: infer C } ? C : undefined
    : undefined;
}

async function handleComposeDeploy(opts: ComposeDeployOpts): Promise<void> {
  const resolvedCompose = resolve(opts.composePath);
  const resolvedContext = resolve(opts.contextPath);

  // Validate compose file exists
  if (!existsSync(resolvedCompose)) {
    console.error(chalk.red(`✗ Compose file not found: ${opts.composePath}`));
    process.exit(1);
  }

  // Parse compose and detect local build contexts
  const composeContent = readFileSync(resolvedCompose, "utf-8");
  const localContexts = detectLocalBuildContexts(composeContent);

  const hasLocalContext = localContexts.some(
    c => c.context === "." || c.context.startsWith("./") || !c.context.includes(":")
  );

  if (!opts.serverId) {
    console.error(chalk.red("✗ --server is required for compose deployments."));
    process.exit(1);
  }

  // ── Dry-run ──────────────────────────────────────────────
  if (opts.dryRun) {
    const plan: Record<string, unknown> = {
      ok: true,
      dryRun: true,
      plan: {
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
        ].filter(Boolean),
      }
    };

    // If local context, show bundle preview
    if (hasLocalContext) {
      try {
        const bundle = await createContextBundle({
          contextPath: resolvedContext,
          extraIgnore: (opts.config as Record<string, unknown>)?.ignore as string[] | undefined,
          extraInclude: (opts.config as Record<string, unknown>)?.include as string[] | undefined,
          maxSizeBytes: (opts.config as Record<string, unknown>)?.maxContextSize
            ? parseSizeString((opts.config as Record<string, unknown>).maxContextSize as string)
            : undefined,
        });

        const sizeMB = (bundle.sizeBytes / 1024 / 1024).toFixed(1);
        (plan.plan as Record<string, unknown>).contextBundle = {
          fileCount: bundle.fileCount,
          size: `${sizeMB}MB`,
          includedOverrides: bundle.includedOverrides,
        };

        // Cleanup temp tar
        try { require("node:fs").unlinkSync(bundle.tarPath); } catch { /* best-effort */ }
      } catch (err) {
        (plan.plan as Record<string, unknown>).contextBundleError =
          err instanceof Error ? err.message : String(err);
      }
    }

    if (opts.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(chalk.bold("\n  Compose Deployment Plan (dry-run)\n"));
      console.log(`  Compose:  ${opts.composePath}`);
      console.log(`  Context:  ${opts.contextPath}`);
      console.log(`  Server:   ${opts.serverId}`);
      console.log(`  Upload:   ${hasLocalContext ? chalk.yellow("yes (local build context)") : chalk.green("no (pre-built images)")}`);

      if (localContexts.length > 0) {
        console.log(chalk.bold("\n  Local Build Contexts:"));
        for (const ctx of localContexts) {
          console.log(`    ${chalk.cyan(ctx.serviceName)}  context=${ctx.context}  dockerfile=${ctx.dockerfile ?? "Dockerfile"}`);
        }
      }

      const bundleInfo = (plan.plan as Record<string, unknown>).contextBundle as
        { fileCount: number; size: string; includedOverrides: string[] } | undefined;
      if (bundleInfo) {
        console.log(chalk.bold("\n  Context Bundle:"));
        console.log(`    Files:     ${bundleInfo.fileCount}`);
        console.log(`    Size:      ${bundleInfo.size}`);
        if (bundleInfo.includedOverrides.length > 0) {
          console.log(`    Overrides: ${chalk.yellow(bundleInfo.includedOverrides.join(", "))}`);
        }
      }

      console.log(chalk.bold("\n  Steps:"));
      for (const step of (plan.plan as Record<string, unknown>).steps as string[]) {
        console.log(`    ${chalk.dim("→")} ${step}`);
      }
      console.log();
    }
    process.exit(3);
  }

  // ── Interactive prompt ───────────────────────────────────
  if (hasLocalContext && opts.prompt && !opts.yes) {
    const sizeMB = await estimateContextSize(resolvedContext, opts.config as Record<string, unknown> | undefined);
    console.log(
      chalk.yellow(
        `\n⚠  ${localContexts.length} service(s) use local build context (${sizeMB}).\n` +
        `   Context will be bundled, uploaded to DaoFlow, and built on server ${opts.serverId}.\n` +
        `   Pass --yes to confirm, or --dry-run to preview.\n`
      )
    );
    process.exit(1);
  }

  if (!opts.yes) {
    console.error(
      chalk.yellow("Destructive operation. Pass --yes to confirm, or use --dry-run to preview.")
    );
    process.exit(1);
  }

  // ── Execute compose deploy ───────────────────────────────
  try {
    if (hasLocalContext) {
      await executeContextDeploy(resolvedCompose, resolvedContext, opts);
    } else {
      await executeRemoteComposeDeploy(resolvedCompose, opts);
    }
  } catch (err) {
    if (opts.json) {
      console.log(JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
        code: "DEPLOY_ERROR"
      }));
    } else {
      console.error(chalk.red(`✗ Deployment failed: ${err instanceof Error ? err.message : err}`));
    }
    process.exit(1);
  }
}

async function executeContextDeploy(
  composePath: string,
  contextPath: string,
  opts: ComposeDeployOpts
): Promise<void> {
  const cfg = opts.config as Record<string, unknown> | undefined;
  const isJson = opts.json;

  // Step 1: Bundle context
  if (!isJson) console.log(chalk.blue("⟳ Bundling build context..."));

  const bundle = await createContextBundle({
    contextPath,
    extraIgnore: cfg?.ignore as string[] | undefined,
    extraInclude: cfg?.include as string[] | undefined,
    maxSizeBytes: cfg?.maxContextSize
      ? parseSizeString(cfg.maxContextSize as string)
      : undefined,
  });

  const sizeMB = (bundle.sizeBytes / 1024 / 1024).toFixed(1);
  if (!isJson) {
    console.log(chalk.green(`✓ Bundled ${bundle.fileCount} files (${sizeMB}MB)`));
    if (bundle.includedOverrides.length > 0) {
      console.log(chalk.yellow(`  ⚠ Included override files: ${bundle.includedOverrides.join(", ")}`));
    }
  }

  // Step 2: Upload context to DaoFlow server
  if (!isJson) console.log(chalk.blue("⟳ Uploading context to DaoFlow..."));

  const ctx = getCurrentContext();
  if (!ctx) throw new Error("Not logged in. Run: daoflow login");

  const composeContent = readFileSync(composePath, "utf-8");
  const fileSize = statSync(bundle.tarPath).size;
  const stream = createReadStream(bundle.tarPath);

  const headers: Record<string, string> = {
    Cookie: `better-auth.session_token=${ctx.token}`,
    "Content-Type": "application/gzip",
    "Content-Length": String(fileSize),
    "X-DaoFlow-Server": opts.serverId ?? "",
    "X-DaoFlow-Compose": Buffer.from(composeContent).toString("base64"),
  };

  if (cfg?.project) headers["X-DaoFlow-Project"] = cfg.project as string;

  const res = await fetch(`${ctx.apiUrl.replace(/\/$/, "")}/api/v1/deploy/context`, {
    method: "POST",
    headers,
    body: stream as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: string });

  // Cleanup temp tar
  try { require("node:fs").unlinkSync(bundle.tarPath); } catch { /* best-effort */ }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed (${res.status}): ${body}`);
  }

  const result = await res.json() as {
    ok: boolean;
    deploymentId?: string;
    contextId?: string;
    error?: string;
  };

  if (isJson) {
    console.log(JSON.stringify(result));
  } else {
    console.log(chalk.green("✓ Context uploaded and deployment queued"));
    if (result.deploymentId) console.log(chalk.dim(`  Deployment ID: ${result.deploymentId}`));
    if (result.contextId) console.log(chalk.dim(`  Context ID:    ${result.contextId}`));
  }
}

async function executeRemoteComposeDeploy(
  composePath: string,
  opts: ComposeDeployOpts
): Promise<void> {
  const isJson = opts.json;
  if (!isJson) console.log(chalk.blue("⟳ Deploying compose (pre-built images)..."));

  const ctx = getCurrentContext();
  if (!ctx) throw new Error("Not logged in. Run: daoflow login");

  const composeContent = readFileSync(composePath, "utf-8");

  const headers: Record<string, string> = {
    Cookie: `better-auth.session_token=${ctx.token}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(`${ctx.apiUrl.replace(/\/$/, "")}/api/v1/deploy/compose`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      server: opts.serverId,
      compose: composeContent,
      project: (opts.config as Record<string, unknown>)?.project,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deploy failed (${res.status}): ${body}`);
  }

  const result = await res.json() as { ok: boolean; deploymentId?: string; error?: string };

  if (isJson) {
    console.log(JSON.stringify(result));
  } else {
    console.log(chalk.green("✓ Compose deployment queued"));
    if (result.deploymentId) console.log(chalk.dim(`  Deployment ID: ${result.deploymentId}`));
  }
}

async function estimateContextSize(
  contextPath: string,
  cfg?: Record<string, unknown>
): Promise<string> {
  try {
    const bundle = await createContextBundle({
      contextPath,
      extraIgnore: cfg?.ignore as string[] | undefined,
      extraInclude: cfg?.include as string[] | undefined,
    });
    const sizeMB = (bundle.sizeBytes / 1024 / 1024).toFixed(1);
    try { require("node:fs").unlinkSync(bundle.tarPath); } catch { /* best-effort */ }
    return `${sizeMB}MB, ${bundle.fileCount} files`;
  } catch {
    return "unknown size";
  }
}
