import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { emitJsonSuccess } from "./command-helpers";
import {
  printComposeDeploymentPlan,
  type ComposeDeploymentPlanPreview
} from "./compose-deployment-plan-output";
import { analyzeComposeInputs } from "./compose-input-analysis";
import { parseSizeString } from "./config-loader";
import { createContextBundle } from "./context-bundler";
import type { ComposeDeployCoreOptions } from "./compose-deploy-types";
import { assertValidComposeUploadContextRoot } from "./compose-upload-context";

export interface ComposeDeploymentPlanClientLike {
  composeDeploymentPlan: {
    query(input: {
      server: string;
      compose: string;
      composePath?: string;
      contextPath?: string;
      repoDefaultContent?: string;
      localBuildContexts: Array<{
        serviceName: string;
        context: string;
        dockerfile?: string | null;
      }>;
      requiresContextUpload: boolean;
      contextBundle?: {
        fileCount: number;
        sizeBytes: number;
        includedOverrides: string[];
      } | null;
      contextBundleError?: string;
    }): Promise<ComposeDeploymentPlanPreview>;
  };
}

function readComposeRepoDefaults(composePath: string): string | undefined {
  const repoDefaultPath = join(dirname(composePath), ".env");
  if (!existsSync(repoDefaultPath)) {
    return undefined;
  }

  return readFileSync(repoDefaultPath, "utf8");
}

export async function fetchComposeDeploymentPlan(
  trpc: ComposeDeploymentPlanClientLike,
  options: ComposeDeployCoreOptions
): Promise<ComposeDeploymentPlanPreview> {
  const resolvedCompose = resolve(options.composePath);
  if (!existsSync(resolvedCompose)) {
    throw new Error(`Compose file not found: ${options.composePath}`);
  }

  const composeContent = readFileSync(resolvedCompose, "utf8");
  const repoDefaultContent = readComposeRepoDefaults(resolvedCompose);
  const composeInputs = analyzeComposeInputs(composeContent);
  const buildContexts = composeInputs.localBuildContexts.map((context) => ({
    serviceName: context.serviceName,
    context: context.context,
    dockerfile: context.dockerfile ?? null
  }));
  const requiresContextUpload = composeInputs.requiresContextUpload;

  assertValidComposeUploadContextRoot({
    composePath: resolvedCompose,
    contextPath: options.contextPath,
    composeInputs
  });

  let contextBundle:
    | {
        fileCount: number;
        sizeBytes: number;
        includedOverrides: string[];
      }
    | null
    | undefined;
  let contextBundleError: string | undefined;

  if (requiresContextUpload) {
    try {
      const bundle = createContextBundle({
        contextPath: resolve(options.contextPath),
        extraIgnore: (options.config as Record<string, unknown>)?.ignore as string[] | undefined,
        extraInclude: (options.config as Record<string, unknown>)?.include as string[] | undefined,
        maxSizeBytes: (options.config as Record<string, unknown>)?.maxContextSize
          ? parseSizeString((options.config as Record<string, unknown>).maxContextSize as string)
          : undefined
      });

      contextBundle = {
        fileCount: bundle.fileCount,
        sizeBytes: bundle.sizeBytes,
        includedOverrides: bundle.includedOverrides
      };

      try {
        unlinkSync(bundle.tarPath);
      } catch {
        /* best-effort */
      }
    } catch (error) {
      contextBundleError = error instanceof Error ? error.message : String(error);
    }
  }

  return await trpc.composeDeploymentPlan.query({
    server: options.serverId,
    compose: composeContent,
    composePath: options.composePath,
    contextPath: options.contextPath,
    repoDefaultContent,
    localBuildContexts: buildContexts,
    requiresContextUpload,
    contextBundle,
    contextBundleError
  });
}

export async function previewComposeDeploy(
  trpc: ComposeDeploymentPlanClientLike,
  options: ComposeDeployCoreOptions
): Promise<void> {
  const plan = await fetchComposeDeploymentPlan(trpc, options);

  if (options.json) {
    emitJsonSuccess({ dryRun: true, plan });
    return;
  }

  printComposeDeploymentPlan(plan, { subtitle: "This plan will NOT be executed." });
}
