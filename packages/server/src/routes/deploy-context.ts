import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { parse as parseYaml } from "yaml";
import { hasAllScopes, normalizeAppRole, roleCapabilities, type AppRole } from "@daoflow/shared";
import { auth } from "../auth";
import { buildComposeBuildPlan } from "../compose-build-plan";
import { deriveComposeStackName } from "../db/services/compose-deployment-plan-build";
import { ensureControlPlaneReady } from "../db/services/seed";
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
  project?: string;
  environment?: string;
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
  const composeFileName = "compose.yaml";

  try {
    await writeFile(join(stageDir, composeFileName), body.compose, "utf8");
    const { artifactId } = await persistUploadedArtifacts({
      sourceDir: stageDir,
      composeFileName
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
        composeFilePath: composeFileName,
        uploadedComposeFileName: composeFileName,
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
        code: "DEPLOY_COMPOSE_FAILED"
      },
      500
    );
  }
});
