import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupStagingDir, ensureStagingDir } from "../worker/docker-executor";

const UPLOAD_METADATA_FILE_NAME = "upload-metadata.json";
const COMPOSE_FILE_NAME = "compose.yaml";
const CONTEXT_ARCHIVE_FILE_NAME = "context.tar.gz";

interface DirectContextUploadMetadata {
  serverId: string;
  projectRef?: string;
  environmentName?: string;
  requestedByUserId: string;
}

export async function createDirectContextUploadSession(input: {
  uploadId: string;
  serverId: string;
  composeContent: string;
  projectRef?: string;
  environmentName?: string;
  requestedByUserId: string;
}): Promise<void> {
  const stageDir = ensureStagingDir(input.uploadId);
  await writeFile(join(stageDir, COMPOSE_FILE_NAME), input.composeContent, "utf8");
  await writeFile(
    join(stageDir, UPLOAD_METADATA_FILE_NAME),
    JSON.stringify({
      serverId: input.serverId,
      projectRef: input.projectRef,
      environmentName: input.environmentName,
      requestedByUserId: input.requestedByUserId
    } satisfies DirectContextUploadMetadata),
    "utf8"
  );
}

export async function loadDirectContextUploadSession(
  uploadId: string,
  requestedByUserId: string
): Promise<{
  stageDir: string;
  composeContent: string;
  serverId: string;
  projectRef?: string;
  environmentName?: string;
  composeFileName: string;
  archiveFileName: string;
} | null> {
  const stageDir = ensureStagingDir(uploadId);
  const metadataPath = join(stageDir, UPLOAD_METADATA_FILE_NAME);
  const composePath = join(stageDir, COMPOSE_FILE_NAME);

  if (!existsSync(metadataPath) || !existsSync(composePath)) {
    cleanupStagingDir(uploadId);
    return null;
  }

  const metadata = JSON.parse(
    await readFile(metadataPath, "utf8")
  ) as Partial<DirectContextUploadMetadata>;

  if (typeof metadata.serverId !== "string" || metadata.serverId.trim() === "") {
    cleanupStagingDir(uploadId);
    return null;
  }

  if (
    typeof metadata.requestedByUserId !== "string" ||
    metadata.requestedByUserId !== requestedByUserId
  ) {
    return null;
  }

  return {
    stageDir,
    composeContent: await readFile(composePath, "utf8"),
    serverId: metadata.serverId,
    projectRef: typeof metadata.projectRef === "string" ? metadata.projectRef : undefined,
    environmentName:
      typeof metadata.environmentName === "string" ? metadata.environmentName : undefined,
    composeFileName: COMPOSE_FILE_NAME,
    archiveFileName: CONTEXT_ARCHIVE_FILE_NAME
  };
}
