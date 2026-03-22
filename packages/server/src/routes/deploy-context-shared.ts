import { type Context } from "hono";
import { parse as parseYaml } from "yaml";
import type { AppRole } from "@daoflow/shared";
import { buildComposeBuildPlan } from "../compose-build-plan";
import { deriveComposeStackName } from "../db/services/compose-deployment-plan-build";
import { ensureDirectDeploymentScope } from "../db/services/direct-deployments";
import { createDeploymentRecord } from "../db/services/deployments";
import { dispatchDeploymentExecution } from "../db/services/deployment-dispatch";
import { authorizeRequest } from "./request-auth";
import { normalize, relative, resolve } from "node:path";

export interface DeployActor {
  userId: string;
  email: string;
  role: AppRole;
}

export interface DirectComposeRequestBody {
  server?: string;
  compose?: string;
  composeFiles?: Array<{
    path?: string;
    contents?: string;
  }>;
  project?: string;
  environment?: string;
}

export const MAX_DIRECT_COMPOSE_BYTES = 1_000_000;

export class DirectComposeRequestError extends Error {
  constructor(
    readonly code: "INVALID_COMPOSE_FILE_PATH" | "INVALID_DEPLOY_CONTEXT_REQUEST",
    message: string
  ) {
    super(message);
  }
}

export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readDirectComposeRequestBody(
  c: Context
): Promise<DirectComposeRequestBody | null> {
  return c.req.json<DirectComposeRequestBody>().catch(() => null);
}

function deriveStackName(composeContent: string, fallback: string): string {
  const doc = (parseYaml(composeContent) as Record<string, unknown> | null) ?? {};
  const buildPlan = buildComposeBuildPlan(doc);
  return deriveComposeStackName(buildPlan, fallback);
}

function ensureComposeBodySize(contents: string, label: string): void {
  if (Buffer.byteLength(contents, "utf8") > MAX_DIRECT_COMPOSE_BYTES) {
    throw new DirectComposeRequestError(
      "INVALID_DEPLOY_CONTEXT_REQUEST",
      `${label} cannot exceed ${MAX_DIRECT_COMPOSE_BYTES} bytes.`
    );
  }
}

function normalizeStagedComposePath(stageDir: string, composePath: string): string {
  const normalizedInput = normalize(composePath)
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "");
  if (
    !normalizedInput ||
    normalizedInput === "." ||
    normalizedInput === ".." ||
    normalizedInput.startsWith("/")
  ) {
    throw new DirectComposeRequestError(
      "INVALID_COMPOSE_FILE_PATH",
      `Compose file path "${composePath}" must stay within the staged deployment workspace.`
    );
  }

  const absoluteTarget = resolve(stageDir, normalizedInput);
  const workspaceRelative = relative(resolve(stageDir), absoluteTarget).replace(/\\/g, "/");
  if (
    !workspaceRelative ||
    workspaceRelative === "." ||
    workspaceRelative === ".." ||
    workspaceRelative.startsWith("../") ||
    workspaceRelative.startsWith("/")
  ) {
    throw new DirectComposeRequestError(
      "INVALID_COMPOSE_FILE_PATH",
      `Compose file path "${composePath}" must stay within the staged deployment workspace.`
    );
  }

  return workspaceRelative;
}

export function resolveUploadedComposeFiles(
  stageDir: string,
  body: DirectComposeRequestBody
): Array<{
  path: string;
  contents: string;
}> {
  if (typeof body.compose !== "string" || body.compose.length === 0) {
    throw new DirectComposeRequestError("INVALID_DEPLOY_CONTEXT_REQUEST", "Missing compose field.");
  }

  ensureComposeBodySize(body.compose, "Compose file");

  if (!body.composeFiles || body.composeFiles.length === 0) {
    return [
      {
        path: "compose.yaml",
        contents: body.compose
      }
    ];
  }

  const composeFiles: Array<{
    path: string;
    contents: string;
  }> = [];
  const seenPaths = new Set<string>();

  for (const entry of body.composeFiles) {
    if (!entry || typeof entry !== "object") {
      throw new DirectComposeRequestError(
        "INVALID_DEPLOY_CONTEXT_REQUEST",
        "composeFiles entries must be objects with path and contents."
      );
    }

    if (typeof entry.path !== "string" || entry.path.trim().length === 0) {
      throw new DirectComposeRequestError(
        "INVALID_COMPOSE_FILE_PATH",
        "Each uploaded compose file must include a non-empty relative path."
      );
    }

    if (typeof entry.contents !== "string") {
      throw new DirectComposeRequestError(
        "INVALID_DEPLOY_CONTEXT_REQUEST",
        `Compose file "${entry.path}" must include string contents.`
      );
    }

    ensureComposeBodySize(entry.contents, `Compose file "${entry.path}"`);
    const normalizedPath = normalizeStagedComposePath(stageDir, entry.path);
    if (seenPaths.has(normalizedPath)) {
      throw new DirectComposeRequestError(
        "INVALID_COMPOSE_FILE_PATH",
        `Compose file path "${entry.path}" was provided more than once.`
      );
    }

    seenPaths.add(normalizedPath);
    composeFiles.push({
      path: normalizedPath,
      contents: entry.contents
    });
  }

  return composeFiles;
}

export async function requireDeployActor(c: Context) {
  const authResult = await authorizeRequest({
    headers: c.req.raw.headers,
    requiredScopes: ["deploy:start"]
  });
  if (!authResult.ok) {
    return c.json(authResult.body, authResult.status);
  }

  return {
    userId: authResult.actor.auth.principal.linkedUserId ?? authResult.actor.auth.principal.id,
    email: authResult.actor.auth.principal.email,
    role: authResult.actor.role
  } satisfies DeployActor;
}

export async function queueUploadedDeployment(input: {
  deploymentId: string;
  serverId: string;
  projectRef?: string;
  environmentName?: string;
  composeContent: string;
  actor: DeployActor;
  configSnapshot: Record<string, unknown>;
  steps: readonly { label: string; detail: string }[];
}) {
  const derivedName = deriveStackName(input.composeContent, "uploaded-compose");
  const scope = await ensureDirectDeploymentScope({
    serverId: input.serverId,
    projectRef: input.projectRef,
    projectName: derivedName,
    environmentName: input.environmentName,
    serviceName: derivedName,
    requestedByUserId: input.actor.userId,
    requestedByEmail: input.actor.email,
    requestedByRole: input.actor.role
  });

  const deployment = await createDeploymentRecord({
    deploymentId: input.deploymentId,
    projectName: scope.project.name,
    environmentName: scope.environment.name,
    serviceName: scope.service.name,
    sourceType: "compose",
    targetServerId: scope.service.targetServerId ?? input.serverId,
    commitSha: "",
    imageTag: "",
    requestedByUserId: input.actor.userId,
    requestedByEmail: input.actor.email,
    requestedByRole: input.actor.role,
    steps: [...input.steps],
    configSnapshot: input.configSnapshot
  });

  if (!deployment) {
    throw new Error("Failed to create deployment record.");
  }

  await dispatchDeploymentExecution(deployment);

  return {
    deployment,
    scope
  };
}
