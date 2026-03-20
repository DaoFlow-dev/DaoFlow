import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, join } from "node:path";
import { newId } from "../db/services/json-helpers";

const UPLOADED_ARTIFACTS_DIR = "uploaded-artifacts";
const ARTIFACT_FILE_MODE = 0o600;
const ARTIFACT_DIR_MODE = 0o700;
const DEFAULT_STAGING_ROOT = "/tmp/daoflow-staging";
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const ARTIFACT_MANIFEST_FILE_NAME = ".daoflow-artifact.json";
const TEMP_ARTIFACT_PREFIX = ".tmp-uploaded-artifact-";

export const UPLOADED_ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const INCOMPLETE_UPLOADED_ARTIFACT_RETENTION_MS = 60 * 60 * 1_000;

interface UploadedArtifactManifest {
  version: 1;
  createdAt: string;
  files: string[];
}

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

async function resolveTemporaryArtifactDir(artifactId: string): Promise<string> {
  return join(
    await ensureArtifactsRoot(),
    `${TEMP_ARTIFACT_PREFIX}${artifactId}-${newId().slice(0, 8)}`
  );
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

function buildLegacyArtifactFileList(input: {
  composeFileName?: string;
  contextArchiveName?: string | null;
}): string[] {
  const files = [input.composeFileName, input.contextArchiveName ?? undefined]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(normalizeArtifactFileName);

  return Array.from(new Set(files));
}

async function writeArtifactManifest(
  artifactDir: string,
  files: string[],
  now = new Date()
): Promise<void> {
  const manifest: UploadedArtifactManifest = {
    version: 1,
    createdAt: now.toISOString(),
    files
  };
  const manifestPath = join(artifactDir, ARTIFACT_MANIFEST_FILE_NAME);
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await chmod(manifestPath, ARTIFACT_FILE_MODE);
}

async function readArtifactManifest(artifactDir: string): Promise<UploadedArtifactManifest | null> {
  const manifestPath = join(artifactDir, ARTIFACT_MANIFEST_FILE_NAME);
  if (!(await pathExists(manifestPath))) {
    return null;
  }

  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<UploadedArtifactManifest>;
  const files = Array.isArray(parsed.files)
    ? parsed.files
        .filter((file): file is string => typeof file === "string")
        .map(normalizeArtifactFileName)
    : [];

  if (parsed.version !== 1 || files.length === 0 || typeof parsed.createdAt !== "string") {
    throw new Error(`Uploaded artifact metadata in "${artifactDir}" is invalid.`);
  }

  return {
    version: 1,
    createdAt: parsed.createdAt,
    files
  };
}

function readIncompleteArtifactError(artifactId: string): Error {
  return new Error(
    `Uploaded artifact "${artifactId}" is incomplete and cannot be replayed. Re-upload the compose source before retrying.`
  );
}

function isExpiredArtifact(entryName: string, ageMs: number): boolean {
  if (entryName.startsWith(TEMP_ARTIFACT_PREFIX)) {
    return ageMs >= INCOMPLETE_UPLOADED_ARTIFACT_RETENTION_MS;
  }

  if (!ARTIFACT_ID_PATTERN.test(entryName)) {
    return false;
  }

  return ageMs >= UPLOADED_ARTIFACT_RETENTION_MS;
}

export async function pruneUploadedArtifacts(
  now = new Date()
): Promise<{ prunedArtifacts: number }> {
  const artifactsRoot = await ensureArtifactsRoot();
  let prunedArtifacts = 0;

  for (const entry of await readdir(artifactsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const artifactPath = join(artifactsRoot, entry.name);
    const ageMs = now.getTime() - (await stat(artifactPath)).mtime.getTime();
    if (!isExpiredArtifact(entry.name, ageMs)) {
      continue;
    }

    await rm(artifactPath, { recursive: true, force: true });
    prunedArtifacts += 1;
  }

  return { prunedArtifacts };
}

export async function persistUploadedArtifacts(input: {
  sourceDir: string;
  composeFileName: string;
  contextArchiveName?: string | null;
  artifactId?: string;
}): Promise<{ artifactId: string }> {
  await pruneUploadedArtifacts();

  const artifactId = normalizeArtifactId(input.artifactId ?? newId());
  const artifactDir = await resolveArtifactDir(artifactId);
  const temporaryArtifactDir = await resolveTemporaryArtifactDir(artifactId);

  if (await pathExists(artifactDir)) {
    throw new Error(`Uploaded artifact "${artifactId}" already exists.`);
  }

  const composeFileName = normalizeArtifactFileName(input.composeFileName);
  const persistedFiles = [composeFileName];
  const contextArchiveName = input.contextArchiveName
    ? normalizeArtifactFileName(input.contextArchiveName)
    : null;
  if (contextArchiveName) {
    persistedFiles.push(contextArchiveName);
  }

  await mkdir(temporaryArtifactDir, { recursive: false, mode: ARTIFACT_DIR_MODE });
  await chmod(temporaryArtifactDir, ARTIFACT_DIR_MODE);

  try {
    await copyArtifactFile(
      join(input.sourceDir, composeFileName),
      join(temporaryArtifactDir, composeFileName)
    );

    if (contextArchiveName) {
      await copyArtifactFile(
        join(input.sourceDir, contextArchiveName),
        join(temporaryArtifactDir, contextArchiveName)
      );
    }

    await writeArtifactManifest(temporaryArtifactDir, persistedFiles);
    await rename(temporaryArtifactDir, artifactDir);
    return { artifactId };
  } catch (error) {
    await rm(temporaryArtifactDir, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreUploadedArtifacts(input: {
  artifactId: string;
  destinationDir: string;
  composeFileName?: string;
  contextArchiveName?: string | null;
}): Promise<{
  restoredFiles: string[];
}> {
  await pruneUploadedArtifacts();

  const artifactDir = await resolveArtifactDir(input.artifactId);
  if (!(await pathExists(artifactDir))) {
    throw new Error(`Uploaded artifact "${input.artifactId}" is no longer available for replay.`);
  }

  const manifest = await readArtifactManifest(artifactDir);
  const expectedFiles = manifest?.files ?? buildLegacyArtifactFileList(input);
  if (expectedFiles.length === 0) {
    throw readIncompleteArtifactError(input.artifactId);
  }

  await mkdir(input.destinationDir, { recursive: true, mode: ARTIFACT_DIR_MODE });
  await chmod(input.destinationDir, ARTIFACT_DIR_MODE);

  const restoredFiles: string[] = [];
  for (const fileName of expectedFiles) {
    const sourcePath = join(artifactDir, fileName);
    if (!(await pathExists(sourcePath))) {
      throw readIncompleteArtifactError(input.artifactId);
    }

    await copyArtifactFile(sourcePath, join(input.destinationDir, fileName));
    restoredFiles.push(fileName);
  }

  return { restoredFiles };
}
