import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { hasAllScopes, normalizeAppRole, roleCapabilities, type AppRole } from "@daoflow/shared";
import { auth } from "../auth";
import { normalizeRelativePath } from "../compose-build-plan-shared";
import { ensureControlPlaneReady } from "../db/services/seed";
import { ensureDirectDeploymentScope } from "../db/services/direct-deployments";
import { createDeploymentRecord } from "../db/services/deployments";
import { dispatchDeploymentExecution } from "../db/services/deployment-dispatch";
import { newId as id } from "../db/services/json-helpers";
import { cleanupStagingDir, ensureStagingDir } from "../worker/docker-executor";
import { persistUploadedArtifacts } from "../worker/uploaded-artifacts";
import { streamBodyToFile } from "./stream-to-file";

export const deployContextRouter = new Hono();

const MAX_UPLOADED_COMPOSE_FILE_COUNT = 20;
const MAX_UPLOADED_COMPOSE_FILE_PATH_LENGTH = 500;
const MAX_UPLOADED_COMPOSE_FILE_CONTENT_LENGTH = 1_000_000;
const MAX_UPLOADED_COMPOSE_PROFILE_COUNT = 20;
const MAX_UPLOADED_COMPOSE_PROFILE_LENGTH = 100;

interface DeployActor {
  userId: string;
  email: string;
  role: AppRole;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deriveStackName(composeContent: string, fallback: string): string {
  const namedMatch = composeContent.match(/^\s*name\s*:\s*["']?([^"'#\n]+)["']?\s*$/m);
  if (namedMatch?.[1]) {
    return namedMatch[1].trim();
  }

  const firstServiceMatch = composeContent.match(/^\s{2}([a-zA-Z0-9._-]+)\s*:\s*$/m);
  if (firstServiceMatch?.[1]) {
    return firstServiceMatch[1].trim();
  }

  return fallback;
}

type UploadedComposeFile = {
  path: string;
  contents: string;
};

class DeployContextRequestError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_DEPLOY_CONTEXT_REQUEST") {
    super(message);
    this.name = "DeployContextRequestError";
    this.code = code;
  }
}

function readUploadedComposeFilesHeader(
  encodedValue: string | undefined,
  fallbackComposeContent: string
): UploadedComposeFile[] {
  if (!encodedValue) {
    return [{ path: "compose.yaml", contents: fallbackComposeContent }];
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedValue, "base64").toString("utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Compose file metadata was not an array.");
    }

    const composeFiles = parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }

      const record = entry as Record<string, unknown>;
      if (typeof record.path !== "string" || typeof record.contents !== "string") {
        return [];
      }

      return [
        {
          path: record.path,
          contents: record.contents
        } satisfies UploadedComposeFile
      ];
    });

    return composeFiles.length > 0
      ? composeFiles
      : [{ path: "compose.yaml", contents: fallbackComposeContent }];
  } catch (error) {
    throw new DeployContextRequestError(
      `Invalid X-DaoFlow-Compose-Files header: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function readUploadedProfilesHeader(encodedValue: string | undefined): string[] {
  if (!encodedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedValue, "base64").toString("utf8")) as unknown;
    return Array.isArray(parsed) ? normalizeUploadedProfiles(parsed) : [];
  } catch (error) {
    throw new DeployContextRequestError(
      `Invalid X-DaoFlow-Compose-Profiles header: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function validateUploadedComposeFiles(composeFiles: UploadedComposeFile[]): void {
  if (composeFiles.length > MAX_UPLOADED_COMPOSE_FILE_COUNT) {
    throw new DeployContextRequestError(
      `A maximum of ${MAX_UPLOADED_COMPOSE_FILE_COUNT} compose files may be uploaded at once.`
    );
  }

  for (const composeFile of composeFiles) {
    if (composeFile.path.trim().length === 0) {
      throw new DeployContextRequestError(
        "Compose file path cannot be empty.",
        "INVALID_COMPOSE_FILE_PATH"
      );
    }

    if (composeFile.path.length > MAX_UPLOADED_COMPOSE_FILE_PATH_LENGTH) {
      throw new DeployContextRequestError(
        `Compose file path exceeds ${MAX_UPLOADED_COMPOSE_FILE_PATH_LENGTH} characters.`,
        "INVALID_COMPOSE_FILE_PATH"
      );
    }

    if (composeFile.contents.length === 0) {
      throw new DeployContextRequestError("Compose file contents cannot be empty.");
    }

    if (composeFile.contents.length > MAX_UPLOADED_COMPOSE_FILE_CONTENT_LENGTH) {
      throw new DeployContextRequestError(
        `Compose file contents exceed ${MAX_UPLOADED_COMPOSE_FILE_CONTENT_LENGTH} bytes.`
      );
    }
  }
}

function normalizeUploadedProfiles(profiles: unknown[]): string[] {
  const normalized = profiles.filter(
    (profile): profile is string => typeof profile === "string" && profile.trim().length > 0
  );

  if (normalized.length > MAX_UPLOADED_COMPOSE_PROFILE_COUNT) {
    throw new DeployContextRequestError(
      `A maximum of ${MAX_UPLOADED_COMPOSE_PROFILE_COUNT} compose profiles may be provided.`
    );
  }

  return normalized.map((profile) => {
    const trimmed = profile.trim();
    if (trimmed.length > MAX_UPLOADED_COMPOSE_PROFILE_LENGTH) {
      throw new DeployContextRequestError(
        `Compose profile names must be ${MAX_UPLOADED_COMPOSE_PROFILE_LENGTH} characters or fewer.`
      );
    }
    return trimmed;
  });
}

function resolveUploadedComposePath(stageDir: string, inputPath: string): string {
  const normalizedInput = normalizeRelativePath(inputPath.trim());
  if (normalizedInput.length === 0 || normalizedInput === ".") {
    throw new DeployContextRequestError(
      "Compose file path cannot be empty.",
      "INVALID_COMPOSE_FILE_PATH"
    );
  }

  const resolvedPath = resolve(stageDir, normalizedInput);
  const workspaceRelativePath = normalizeRelativePath(relative(stageDir, resolvedPath));

  if (
    isAbsolute(normalizedInput) ||
    workspaceRelativePath.length === 0 ||
    workspaceRelativePath === "." ||
    workspaceRelativePath === ".." ||
    workspaceRelativePath.startsWith("../") ||
    isAbsolute(workspaceRelativePath)
  ) {
    throw new DeployContextRequestError(
      `Compose file path must stay within the staged deployment workspace: ${inputPath}`,
      "INVALID_COMPOSE_FILE_PATH"
    );
  }

  return workspaceRelativePath;
}

async function stageUploadedComposeFiles(
  stageDir: string,
  composeFiles: UploadedComposeFile[]
): Promise<UploadedComposeFile[]> {
  validateUploadedComposeFiles(composeFiles);
  const stagedFiles: UploadedComposeFile[] = [];

  for (const composeFile of composeFiles) {
    const safeRelativePath = resolveUploadedComposePath(stageDir, composeFile.path);
    const destination = join(stageDir, safeRelativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, composeFile.contents, "utf8");
    stagedFiles.push({
      path: safeRelativePath,
      contents: composeFile.contents
    });
  }

  return stagedFiles;
}

async function requireDeployActor(c: Context) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json(
      {
        ok: false,
        error: "Valid authentication required. Provide a session cookie.",
        code: "AUTH_REQUIRED"
      },
      401
    );
  }

  await ensureControlPlaneReady();

  const role = normalizeAppRole((session.user as Record<string, unknown>).role);
  if (!hasAllScopes(roleCapabilities[role], ["deploy:start"])) {
    return c.json(
      {
        ok: false,
        error: "Missing required scope(s): deploy:start",
        code: "SCOPE_DENIED",
        requiredScope: "deploy:start"
      },
      403
    );
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    role
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

deployContextRouter.post("/", async (c) => {
  const actor = await requireDeployActor(c);
  if ("status" in actor) {
    return actor;
  }

  const serverId = c.req.header("X-DaoFlow-Server") ?? "";
  const composeB64 = c.req.header("X-DaoFlow-Compose") ?? "";
  const composeFilesB64 = c.req.header("X-DaoFlow-Compose-Files") ?? undefined;
  const composeProfilesB64 = c.req.header("X-DaoFlow-Compose-Profiles") ?? undefined;
  const projectRef = c.req.header("X-DaoFlow-Project") ?? undefined;
  const environmentName = c.req.header("X-DaoFlow-Environment") ?? undefined;

  if (!serverId) {
    return c.json(
      { ok: false, error: "Missing X-DaoFlow-Server header", code: "MISSING_SERVER" },
      400
    );
  }

  if (!composeB64) {
    return c.json(
      { ok: false, error: "Missing X-DaoFlow-Compose header", code: "MISSING_COMPOSE" },
      400
    );
  }

  const body = c.req.raw.body;
  if (!body) {
    return c.json({ ok: false, error: "No request body provided.", code: "EMPTY_BODY" }, 400);
  }

  const deploymentId = id();
  const stageDir = ensureStagingDir(deploymentId);
  const composeFileName = "compose.yaml";
  const archiveFileName = "context.tar.gz";

  try {
    const composeContent = Buffer.from(composeB64, "base64").toString("utf8");
    const composeFiles = await stageUploadedComposeFiles(
      stageDir,
      readUploadedComposeFilesHeader(composeFilesB64, composeContent)
    );
    const composeProfiles = readUploadedProfilesHeader(composeProfilesB64);
    await streamBodyToFile(body, join(stageDir, archiveFileName));
    const { artifactId } = await persistUploadedArtifacts({
      sourceDir: stageDir,
      composeFileName,
      composeFileNames: composeFiles.map((composeFile) => composeFile.path),
      contextArchiveName: archiveFileName
    });

    const { deployment, scope } = await queueUploadedDeployment({
      deploymentId,
      serverId,
      projectRef,
      environmentName,
      composeContent,
      actor,
      configSnapshot: {
        deploymentSource: "uploaded-context",
        composeFilePath: composeFiles[0]?.path ?? composeFileName,
        composeFilePaths: composeFiles.map((composeFile) => composeFile.path),
        ...(composeProfiles.length > 0 ? { composeProfiles } : {}),
        uploadedComposeFileName: composeFileName,
        uploadedComposeFileNames: composeFiles.map((composeFile) => composeFile.path),
        uploadedContextArchiveName: archiveFileName,
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
    cleanupStagingDir(deploymentId);
    return c.json(
      {
        ok: false,
        error: readErrorMessage(error),
        code: error instanceof DeployContextRequestError ? error.code : "DEPLOY_CONTEXT_FAILED"
      },
      error instanceof DeployContextRequestError ? 400 : 500
    );
  }
});

deployContextRouter.post("/compose", async (c) => {
  const actor = await requireDeployActor(c);
  if ("status" in actor) {
    return actor;
  }

  const body = await c.req.json<{
    server?: string;
    compose?: string;
    composeFiles?: UploadedComposeFile[];
    profiles?: string[];
    project?: string;
    environment?: string;
  }>();

  if (!body.server) {
    return c.json({ ok: false, error: "Missing server field", code: "MISSING_SERVER" }, 400);
  }

  if (!body.compose) {
    return c.json({ ok: false, error: "Missing compose field", code: "MISSING_COMPOSE" }, 400);
  }

  if (body.compose.length > MAX_UPLOADED_COMPOSE_FILE_CONTENT_LENGTH) {
    return c.json(
      {
        ok: false,
        error: `Compose file contents exceed ${MAX_UPLOADED_COMPOSE_FILE_CONTENT_LENGTH} bytes.`,
        code: "INVALID_DEPLOY_CONTEXT_REQUEST"
      },
      400
    );
  }

  const deploymentId = id();
  const stageDir = ensureStagingDir(deploymentId);
  const composeFileName = "compose.yaml";

  try {
    const composeFiles = await stageUploadedComposeFiles(
      stageDir,
      Array.isArray(body.composeFiles) && body.composeFiles.length > 0
        ? body.composeFiles
        : [{ path: composeFileName, contents: body.compose }]
    );
    const composeProfiles = Array.isArray(body.profiles)
      ? normalizeUploadedProfiles(body.profiles)
      : [];
    const { artifactId } = await persistUploadedArtifacts({
      sourceDir: stageDir,
      composeFileName,
      composeFileNames: composeFiles.map((composeFile) => composeFile.path)
    });

    const { deployment, scope } = await queueUploadedDeployment({
      deploymentId,
      serverId: body.server,
      projectRef: body.project,
      environmentName: body.environment,
      composeContent: body.compose,
      actor,
      configSnapshot: {
        deploymentSource: "uploaded-compose",
        composeFilePath: composeFiles[0]?.path ?? composeFileName,
        composeFilePaths: composeFiles.map((composeFile) => composeFile.path),
        ...(composeProfiles.length > 0 ? { composeProfiles } : {}),
        uploadedComposeFileName: composeFileName,
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
    return c.json(
      {
        ok: false,
        error: readErrorMessage(error),
        code: error instanceof DeployContextRequestError ? error.code : "DEPLOY_COMPOSE_FAILED"
      },
      error instanceof DeployContextRequestError ? 400 : 500
    );
  }
});
