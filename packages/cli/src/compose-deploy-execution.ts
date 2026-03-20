import { createReadStream, statSync, unlinkSync } from "node:fs";
import { basename } from "node:path";
import { ApiClient, ApiError } from "./api-client";
import { emitJsonSuccess } from "./command-helpers";
import { analyzeComposeInputs } from "./compose-input-analysis";
import { parseSizeString } from "./config-loader";
import { createContextBundle } from "./context-bundler";
import type { ComposeDeployCoreOptions } from "./compose-deploy-types";
import { assertValidComposeUploadContextRoot } from "./compose-upload-context";

export async function executeComposeDeploy(
  composeContent: string,
  requiresContextUpload: boolean,
  options: ComposeDeployCoreOptions
): Promise<void> {
  if (requiresContextUpload) {
    assertValidComposeUploadContextRoot({
      composePath: options.composePath,
      contextPath: options.contextPath,
      composeInputs: analyzeComposeInputs(composeContent)
    });
    await uploadContextBundle(options.contextPath, composeContent, options);
    return;
  }

  await executeRemoteComposeDeploy(composeContent, options);
}

function executeRemoteComposeDeploy(
  composeContent: string,
  options: ComposeDeployCoreOptions
): Promise<void> {
  const api = new ApiClient();
  return api
    .post<{
      ok: boolean;
      deploymentId: string;
    }>("/api/v1/deploy/compose", {
      server: options.serverId,
      compose: composeContent,
      project: deriveProjectName(options.composePath, composeContent)
    })
    .then((response) => {
      renderQueuedDeployment(response.deploymentId, options);
    })
    .catch((error) => {
      throw normalizeDeployError(error);
    });
}

async function uploadContextBundle(
  contextPath: string,
  composeContent: string,
  options: ComposeDeployCoreOptions
): Promise<void> {
  const bundle = createContextBundle({
    contextPath,
    extraIgnore: (options.config as Record<string, unknown>)?.ignore as string[] | undefined,
    extraInclude: (options.config as Record<string, unknown>)?.include as string[] | undefined,
    maxSizeBytes: (options.config as Record<string, unknown>)?.maxContextSize
      ? parseSizeString((options.config as Record<string, unknown>).maxContextSize as string)
      : undefined
  });

  const api = new ApiClient();

  try {
    const intake = (await api.post<{
      ok: boolean;
      uploadId: string;
    }>("/api/v1/deploy/uploads/intake", {
      server: options.serverId,
      compose: composeContent,
      project: deriveProjectName(options.composePath, composeContent)
    })) as { ok: boolean; uploadId: string };

    const response = (await api.streamUpload(
      `/api/v1/deploy/uploads/${intake.uploadId}`,
      createReadStream(bundle.tarPath),
      statSync(bundle.tarPath).size,
      {
        contentType: "application/gzip"
      }
    )) as { ok: boolean; deploymentId: string };

    renderQueuedDeployment(response.deploymentId, options);
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

function renderQueuedDeployment(deploymentId: string, options: ComposeDeployCoreOptions): void {
  if (options.json) {
    emitJsonSuccess({ deploymentId, serverId: options.serverId });
    return;
  }

  console.log("✓ Deployment queued");
  console.log(`  ID: ${deploymentId}`);
  console.log(`  Server: ${options.serverId}`);
}

export function estimateContextSize(contextPath: string, config?: Record<string, unknown>): string {
  try {
    const bundle = createContextBundle({
      contextPath,
      extraIgnore: config?.ignore as string[] | undefined,
      extraInclude: config?.include as string[] | undefined
    });
    const sizeMb = (bundle.sizeBytes / 1024 / 1024).toFixed(1);
    try {
      unlinkSync(bundle.tarPath);
    } catch {
      /* best-effort */
    }
    return `${sizeMb}MB, ${bundle.fileCount} files`;
  } catch {
    return "unknown size";
  }
}
