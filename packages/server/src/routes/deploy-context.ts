import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { parse as parseYaml } from "yaml";
import type { AppRole } from "@daoflow/shared";
import { buildComposeBuildPlan } from "../compose-build-plan";
import { deriveComposeStackName } from "../db/services/compose-deployment-plan-build";
import { ensureDirectDeploymentScope } from "../db/services/direct-deployments";
import { createDeploymentRecord } from "../db/services/deployments";
import { dispatchDeploymentExecution } from "../db/services/deployment-dispatch";
import { newId as id } from "../db/services/json-helpers";
import { cleanupStagingDir, ensureStagingDir } from "../worker/docker-executor";
import { persistUploadedArtifacts } from "../worker/uploaded-artifacts";
import {
  createDirectContextUploadSession,
  loadDirectContextUploadSession
} from "./deploy-context-upload";
import { authorizeRequest } from "./request-auth";
import { streamBodyToFile } from "./stream-to-file";

export const deployContextRouter = new Hono();

interface DeployActor {
  userId: string;
  email: string;
  role: AppRole;
}

interface DirectComposeRequestBody {
  server?: string;
  compose?: string;
  composeFiles?: Array<{
    path?: string;
    contents?: string;
  }>;
  project?: string;
  environment?: string;
}

const MAX_DIRECT_COMPOSE_BYTES = 1_000_000;

class DirectComposeRequestError extends Error {
  constructor(
    readonly code: "INVALID_COMPOSE_FILE_PATH" | "INVALID_DEPLOY_CONTEXT_REQUEST",
    message: string
  ) {
    super(message);
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readDirectComposeRequestBody(c: Context): Promise<DirectComposeRequestBody | null> {
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

function resolveUploadedComposeFiles(
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

async function requireDeployActor(c: Context) {
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

async function queueUploadedDeployment(input: {
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

deployContextRouter.post("/uploads/intake", async (c) => {
  const actor = await requireDeployActor(c);
  if ("status" in actor) {
    return actor;
  }

  const body = await readDirectComposeRequestBody(c);
  if (!body) {
    return c.json({ ok: false, error: "Malformed JSON body", code: "INVALID_JSON" }, 400);
  }

  if (!body.server) {
    return c.json({ ok: false, error: "Missing server field", code: "MISSING_SERVER" }, 400);
  }

  if (!body.compose) {
    return c.json({ ok: false, error: "Missing compose field", code: "MISSING_COMPOSE" }, 400);
  }

  const uploadId = id();

  try {
    await createDirectContextUploadSession({
      uploadId,
      serverId: body.server,
      composeContent: body.compose,
      projectRef: body.project,
      environmentName: body.environment,
      requestedByUserId: actor.userId
    });

    return c.json({
      ok: true,
      uploadId
    });
  } catch (error) {
    cleanupStagingDir(uploadId);
    return c.json(
      {
        ok: false,
        error: readErrorMessage(error),
        code: "DEPLOY_CONTEXT_FAILED"
      },
      500
    );
  }
});

deployContextRouter.post("/uploads/:uploadId", async (c) => {
  const actor = await requireDeployActor(c);
  if ("status" in actor) {
    return actor;
  }

  const uploadId = c.req.param("uploadId");
  const body = c.req.raw.body;
  if (!body) {
    return c.json({ ok: false, error: "No request body provided.", code: "EMPTY_BODY" }, 400);
  }

  const upload = await loadDirectContextUploadSession(uploadId, actor.userId);
  if (!upload) {
    return c.json(
      {
        ok: false,
        error: `Upload session "${uploadId}" was not found.`,
        code: "UPLOAD_NOT_FOUND"
      },
      404
    );
  }

  try {
    await streamBodyToFile(body, `${upload.stageDir}/${upload.archiveFileName}`);
    const { artifactId } = await persistUploadedArtifacts({
      sourceDir: upload.stageDir,
      composeFileName: upload.composeFileName,
      contextArchiveName: upload.archiveFileName
    });

    const { deployment, scope } = await queueUploadedDeployment({
      deploymentId: uploadId,
      serverId: upload.serverId,
      projectRef: upload.projectRef,
      environmentName: upload.environmentName,
      composeContent: upload.composeContent,
      actor,
      configSnapshot: {
        deploymentSource: "uploaded-context",
        composeFilePath: upload.composeFileName,
        uploadedComposeFileName: upload.composeFileName,
        uploadedContextArchiveName: upload.archiveFileName,
        uploadedArtifactId: artifactId
      },
      steps: [
        {
          label: "Stage uploaded context",
          detail: "Store the uploaded build context and compose file in durable staging."
        },
        {
          label: "Queue execution handoff",
          detail: "Dispatch the uploaded compose workspace to the execution plane."
        }
      ]
    });

    return c.json({
      ok: true,
      deploymentId: deployment.id,
      projectId: scope.project.id,
      environmentId: scope.environment.id,
      serviceId: scope.service.id
    });
  } catch (error) {
    cleanupStagingDir(uploadId);
    return c.json(
      {
        ok: false,
        error: readErrorMessage(error),
        code: "DEPLOY_CONTEXT_FAILED"
      },
      500
    );
  }
});

deployContextRouter.post("/compose", async (c) => {
  const actor = await requireDeployActor(c);
  if ("status" in actor) {
    return actor;
  }

  const body = await readDirectComposeRequestBody(c);
  if (!body) {
    return c.json({ ok: false, error: "Malformed JSON body", code: "INVALID_JSON" }, 400);
  }

  if (!body.server) {
    return c.json({ ok: false, error: "Missing server field", code: "MISSING_SERVER" }, 400);
  }

  if (!body.compose) {
    return c.json({ ok: false, error: "Missing compose field", code: "MISSING_COMPOSE" }, 400);
  }

  const deploymentId = id();
  const stageDir = ensureStagingDir(deploymentId);

  try {
    const composeFiles = resolveUploadedComposeFiles(stageDir, body);
    for (const composeFile of composeFiles) {
      await mkdir(dirname(join(stageDir, composeFile.path)), { recursive: true });
      await writeFile(join(stageDir, composeFile.path), composeFile.contents, "utf8");
    }

    const primaryComposeFile = composeFiles[0];
    if (!primaryComposeFile) {
      throw new DirectComposeRequestError(
        "INVALID_DEPLOY_CONTEXT_REQUEST",
        "At least one compose file is required."
      );
    }

    const { artifactId } = await persistUploadedArtifacts({
      sourceDir: stageDir,
      composeFileName: primaryComposeFile.path,
      composeFileNames: composeFiles.map((composeFile) => composeFile.path)
    });

    const { deployment, scope } = await queueUploadedDeployment({
      deploymentId,
      serverId: body.server,
      projectRef: body.project,
      environmentName: body.environment,
      composeContent: primaryComposeFile.contents,
      actor,
      configSnapshot: {
        deploymentSource: "uploaded-compose",
        composeFilePath: primaryComposeFile.path,
        composeFilePaths: composeFiles.map((composeFile) => composeFile.path),
        uploadedComposeFileName: primaryComposeFile.path,
        uploadedComposeFileNames: composeFiles.map((composeFile) => composeFile.path),
        uploadedArtifactId: artifactId
      },
      steps: [
        {
          label: "Stage uploaded compose",
          detail: "Store the uploaded compose file in durable staging."
        },
        {
          label: "Queue execution handoff",
          detail: "Dispatch the compose deployment to the execution plane."
        }
      ]
    });

    return c.json({
      ok: true,
      deploymentId: deployment.id,
      projectId: scope.project.id,
      environmentId: scope.environment.id,
      serviceId: scope.service.id
    });
  } catch (error) {
    cleanupStagingDir(deploymentId);
    if (error instanceof DirectComposeRequestError) {
      return c.json(
        {
          ok: false,
          error: error.message,
          code: error.code
        },
        400
      );
    }
    return c.json(
      {
        ok: false,
        error: readErrorMessage(error),
        code: "DEPLOY_COMPOSE_FAILED"
      },
      500
    );
  }
});
