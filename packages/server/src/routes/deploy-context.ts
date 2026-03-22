import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { newId as id } from "../db/services/json-helpers";
import { cleanupStagingDir, ensureStagingDir } from "../worker/docker-executor";
import { persistUploadedArtifacts } from "../worker/uploaded-artifacts";
import {
  createDirectContextUploadSession,
  loadDirectContextUploadSession
} from "./deploy-context-upload";
import {
  DirectComposeRequestError,
  queueUploadedDeployment,
  readDirectComposeRequestBody,
  readErrorMessage,
  requireDeployActor,
  resolveUploadedComposeFiles
} from "./deploy-context-shared";
import { streamBodyToFile } from "./stream-to-file";

export const deployContextRouter = new Hono();

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
