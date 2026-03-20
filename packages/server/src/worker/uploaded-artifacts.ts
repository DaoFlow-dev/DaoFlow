import { chmod, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { normalizeRelativePath } from "../compose-build-plan-shared";
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

function normalizeArtifactFilePath(fileName: string): string {
  const normalized = normalizeRelativePath(fileName.trim());
  if (!normalized || normalized === ".") {
    throw new Error(`Invalid uploaded artifact file "${fileName}".`);
  }

  const resolvedPath = resolve("/uploaded-artifact", normalized);
  const relativePath = normalizeRelativePath(relative("/uploaded-artifact", resolvedPath));

  if (
    isAbsolute(normalized) ||
    !relativePath ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Invalid uploaded artifact file "${fileName}".`);
  }

  return relativePath;
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
  await mkdir(dirname(destinationPath), { recursive: true, mode: ARTIFACT_DIR_MODE });
  await copyFile(sourcePath, destinationPath);
  await chmod(destinationPath, ARTIFACT_FILE_MODE);
}

async function listArtifactFiles(currentDir: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    const entryPath = join(currentDir, entry.name);
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await listArtifactFiles(entryPath, relativePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(normalizeRelativePath(relativePath));
    }
  }

  return files;
}

export async function persistUploadedArtifacts(input: {
  sourceDir: string;
  composeFileName: string;
  composeFileNames?: string[];
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

  const composeFileNames =
    input.composeFileNames && input.composeFileNames.length > 0
      ? input.composeFileNames
      : [input.composeFileName];
  for (const composeFileName of composeFileNames) {
    const normalizedComposeFileName = normalizeArtifactFilePath(composeFileName);
    await copyArtifactFile(
      join(input.sourceDir, normalizedComposeFileName),
      join(artifactDir, normalizedComposeFileName)
    );
  }

  if (input.contextArchiveName) {
    const contextArchiveName = normalizeArtifactFilePath(input.contextArchiveName);
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
  for (const relativePath of await listArtifactFiles(artifactDir)) {
    await copyArtifactFile(
      join(artifactDir, relativePath),
      join(input.destinationDir, relativePath)
    );
    restoredFiles.push(relativePath);
  }

  return { restoredFiles };
}
