import { chmod, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { newId } from "../db/services/json-helpers";

const UPLOADED_ARTIFACTS_DIR = "uploaded-artifacts";
const ARTIFACT_FILE_MODE = 0o600;
const ARTIFACT_DIR_MODE = 0o700;
const DEFAULT_STAGING_ROOT = "/tmp/daoflow-staging";
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{32}$/i;

function getStagingRoot(): string {
  return process.env.GIT_WORK_DIR ?? DEFAULT_STAGING_ROOT;
}

async function ensureArtifactsRoot(): Promise<string> {
  const root = join(getStagingRoot(), UPLOADED_ARTIFACTS_DIR);
  await mkdir(root, { recursive: true, mode: ARTIFACT_DIR_MODE });
  await chmod(root, ARTIFACT_DIR_MODE);
  return root;
}

function normalizeArtifactId(artifactId: string): string {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new Error(`Invalid uploaded artifact id "${artifactId}".`);
  }
  return artifactId.toLowerCase();
}

function normalizeArtifactFileName(fileName: string): string {
  const normalized = basename(fileName);
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error(`Invalid uploaded artifact file "${fileName}".`);
  }
  return normalized;
}

async function resolveArtifactDir(artifactId: string): Promise<string> {
  return join(await ensureArtifactsRoot(), normalizeArtifactId(artifactId));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyArtifactFile(sourcePath: string, destinationPath: string): Promise<void> {
  await copyFile(sourcePath, destinationPath);
  await chmod(destinationPath, ARTIFACT_FILE_MODE);
}

export async function persistUploadedArtifacts(input: {
  sourceDir: string;
  composeFileName: string;
  contextArchiveName?: string | null;
  artifactId?: string;
}): Promise<{ artifactId: string }> {
  const artifactId = normalizeArtifactId(input.artifactId ?? newId());
  const artifactDir = await resolveArtifactDir(artifactId);

  if (await pathExists(artifactDir)) {
    throw new Error(`Uploaded artifact "${artifactId}" already exists.`);
  }

  await mkdir(artifactDir, { recursive: false, mode: ARTIFACT_DIR_MODE });
  await chmod(artifactDir, ARTIFACT_DIR_MODE);

  const composeFileName = normalizeArtifactFileName(input.composeFileName);
  await copyArtifactFile(
    join(input.sourceDir, composeFileName),
    join(artifactDir, composeFileName)
  );

  if (input.contextArchiveName) {
    const contextArchiveName = normalizeArtifactFileName(input.contextArchiveName);
    await copyArtifactFile(
      join(input.sourceDir, contextArchiveName),
      join(artifactDir, contextArchiveName)
    );
  }

  return { artifactId };
}

export async function restoreUploadedArtifacts(input: {
  artifactId: string;
  destinationDir: string;
  composeFileName?: string;
  contextArchiveName?: string | null;
}): Promise<{
  restoredFiles: string[];
}> {
  const artifactDir = await resolveArtifactDir(input.artifactId);
  if (!(await pathExists(artifactDir))) {
    throw new Error(`Uploaded artifact "${input.artifactId}" is no longer available for replay.`);
  }

  await mkdir(input.destinationDir, { recursive: true, mode: ARTIFACT_DIR_MODE });
  await chmod(input.destinationDir, ARTIFACT_DIR_MODE);

  const restoredFiles: string[] = [];
  for (const entry of await readdir(artifactDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    await copyArtifactFile(join(artifactDir, entry.name), join(input.destinationDir, entry.name));
    restoredFiles.push(entry.name);
  }

  return { restoredFiles };
}
