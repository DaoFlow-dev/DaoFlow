import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type { ComposeBuildPlan } from "./compose-build-plan";

export const RENDERED_COMPOSE_FILE_NAME = ".daoflow.compose.rendered.yaml";
export const FROZEN_COMPOSE_INPUT_DIR = ".daoflow.compose.inputs";

export type ComposeInputManifestEntryKind =
  | "compose-file"
  | "repo-default-env"
  | "compose-env"
  | "service-env-file";

export type ComposeInputManifestProvenance =
  | "repository-checkout"
  | "uploaded-artifact"
  | "daoflow-generated";

export interface ComposeInputManifestEntry {
  kind: ComposeInputManifestEntryKind;
  path: string;
  sourcePath: string | null;
  sha256: string;
  sizeBytes: number;
  provenance: ComposeInputManifestProvenance;
  services: string[];
}

export interface ComposeInputManifest {
  status: "materialized";
  version: 1;
  entries: ComposeInputManifestEntry[];
  warnings: string[];
}

export interface FrozenComposeEnvFilePayload {
  path: string;
  sourcePath: string;
  contents: string;
  services: string[];
}

export interface ComposeImageOverrideRequest {
  serviceName: string;
  imageReference: string;
}

export interface FrozenComposeInputsPayload {
  composeFile: {
    path: string;
    sourcePath: string;
    contents: string;
  };
  envFiles: FrozenComposeEnvFilePayload[];
}

export interface MaterializedComposeInputs {
  composeFile: string;
  buildPlan: ComposeBuildPlan;
  manifest: ComposeInputManifest;
  frozenInputs: FrozenComposeInputsPayload;
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

export function normalizeRelativePath(path: string): string {
  return normalize(path).replace(/\\/g, "/");
}

function sanitizeFrozenPath(path: string): string {
  return normalizeRelativePath(path)
    .replace(/^\.\//, "")
    .replace(/\.\.\//g, "__up__/")
    .replace(/^\//, "root/")
    .replace(/[^A-Za-z0-9._/-]+/g, "_");
}

export function resolveComposeRelativePath(
  workDir: string,
  composeFile: string,
  path: string
): string {
  if (isAbsolute(path)) {
    throw new Error(`Compose env_file "${path}" must stay within the deployment workspace.`);
  }

  const resolvedWorkDir = resolve(workDir);
  const composeDir = dirname(composeFile);
  const resolvedTarget =
    composeDir === "." || composeDir === ""
      ? resolve(resolvedWorkDir, path)
      : resolve(resolvedWorkDir, composeDir, path);
  const workspaceRelative = relative(resolvedWorkDir, resolvedTarget);

  if (
    workspaceRelative.startsWith("../") ||
    workspaceRelative === ".." ||
    isAbsolute(workspaceRelative)
  ) {
    throw new Error(`Compose env_file "${path}" resolves outside of the deployment workspace.`);
  }

  return resolvedTarget;
}

export function buildManifestEntry(input: {
  kind: ComposeInputManifestEntryKind;
  path: string;
  sourcePath?: string | null;
  contents: string;
  provenance: ComposeInputManifestProvenance;
  services?: string[];
}): ComposeInputManifestEntry {
  return {
    kind: input.kind,
    path: normalizeRelativePath(input.path),
    sourcePath: input.sourcePath ? normalizeRelativePath(input.sourcePath) : null,
    sha256: sha256(input.contents),
    sizeBytes: Buffer.byteLength(input.contents, "utf8"),
    provenance: input.provenance,
    services: [...(input.services ?? [])].sort((a, b) => a.localeCompare(b))
  };
}

function writeFrozenFile(workDir: string, relativePath: string, contents: string): void {
  const targetPath = join(workDir, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents, { mode: 0o600 });
}

export function buildFrozenEnvFilePath(originalPath: string): string {
  const sanitizedPath = sanitizeFrozenPath(originalPath);
  const fileName = basename(sanitizedPath) || "env-file";
  const parent = dirname(sanitizedPath);
  const prefix = parent === "." ? "" : `${parent.replace(/\//g, "__")}__`;
  return normalizeRelativePath(join(FROZEN_COMPOSE_INPUT_DIR, `${prefix}${fileName}`));
}

export function materializeFrozenComposeInputs(
  workDir: string,
  payload: FrozenComposeInputsPayload
): string {
  writeFrozenFile(workDir, payload.composeFile.path, payload.composeFile.contents);

  for (const envFile of payload.envFiles) {
    writeFrozenFile(workDir, envFile.path, envFile.contents);
  }

  return payload.composeFile.path;
}

export function sortManifestEntries(
  entries: ComposeInputManifestEntry[]
): ComposeInputManifestEntry[] {
  return [...entries].sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`));
}
