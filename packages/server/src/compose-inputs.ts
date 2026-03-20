import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  buildComposeBuildPlan,
  rewriteComposeBuildAndSecretReferences,
  type ComposeBuildPlan
} from "./compose-build-plan";
import { COMPOSE_ENV_FILE_NAME } from "./compose-env";
import { mergeComposeDocuments } from "./compose-merge";
import { normalizeComposeProfiles } from "./compose-source";

export const RENDERED_COMPOSE_FILE_NAME = ".daoflow.compose.rendered.yaml";
export const FROZEN_COMPOSE_INPUT_DIR = ".daoflow.compose.inputs";

export type ComposeInputManifestEntryKind =
  | "compose-file"
  | "rendered-compose-file"
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

export interface FrozenComposeFilePayload {
  path: string;
  sourcePath: string | null;
  contents: string;
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
  composeFiles?: FrozenComposeFilePayload[];
  composeFile?: FrozenComposeFilePayload;
  envFiles: FrozenComposeEnvFilePayload[];
  profiles?: string[];
  renderedCompose?: {
    path: string;
    contents: string;
  };
}

export interface MaterializedComposeInputs {
  composeFile: string;
  composeFiles: string[];
  buildPlan: ComposeBuildPlan;
  manifest: ComposeInputManifest;
  frozenInputs: FrozenComposeInputsPayload;
}

interface ComposeEnvFileReference {
  serviceName: string;
  path: string;
  required: boolean;
  format?: string;
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

function normalizeRelativePath(path: string): string {
  return normalize(path).replace(/\\/g, "/");
}

function sanitizeFrozenPath(path: string): string {
  return normalizeRelativePath(path)
    .replace(/^\.\//, "")
    .replace(/\.\.\//g, "__up__/")
    .replace(/^\//, "root/")
    .replace(/[^A-Za-z0-9._/-]+/g, "_");
}

function parseComposeDocument(contents: string): Record<string, unknown> {
  return (parseYaml(contents) as Record<string, unknown> | null) ?? {};
}

function resolveComposeRelativePath(workDir: string, composeFile: string, path: string): string {
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

function buildManifestEntry(input: {
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

function collectServiceEnvFileReferences(
  doc: Record<string, unknown>
): Map<string, ComposeEnvFileReference[]> {
  const services =
    doc.services && typeof doc.services === "object" && !Array.isArray(doc.services)
      ? (doc.services as Record<string, unknown>)
      : null;
  const results = new Map<string, ComposeEnvFileReference[]>();

  if (!services) {
    return results;
  }

  for (const [serviceName, value] of Object.entries(services)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const service = value as Record<string, unknown>;
    const envFile = service.env_file;
    const references: ComposeEnvFileReference[] = [];

    const pushReference = (path: string, required: boolean, format?: string) => {
      references.push({
        serviceName,
        path,
        required,
        ...(format ? { format } : {})
      });
    };

    if (typeof envFile === "string") {
      pushReference(envFile, true);
    } else if (Array.isArray(envFile)) {
      for (const entry of envFile) {
        if (typeof entry === "string") {
          pushReference(entry, true);
          continue;
        }

        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const record = entry as Record<string, unknown>;
          if (typeof record.path === "string") {
            pushReference(
              record.path,
              record.required !== false,
              typeof record.format === "string" ? record.format : undefined
            );
          }
        }
      }
    }

    if (references.length > 0) {
      results.set(serviceName, references);
    }
  }

  return results;
}

function buildFrozenEnvFilePath(originalPath: string): string {
  const sanitizedPath = sanitizeFrozenPath(originalPath);
  const fileName = basename(sanitizedPath) || "env-file";
  const parent = dirname(sanitizedPath);
  const prefix = parent === "." ? "" : `${parent.replace(/\//g, "__")}__`;
  return normalizeRelativePath(join(FROZEN_COMPOSE_INPUT_DIR, `${prefix}${fileName}`));
}

function buildFrozenComposeFilePath(originalPath: string, index: number): string {
  const sanitizedPath = sanitizeFrozenPath(originalPath).replace(/\//g, "__");
  const extension = basename(originalPath).match(/\.(ya?ml)$/i)?.[0] ?? ".yaml";
  return normalizeRelativePath(
    join(
      FROZEN_COMPOSE_INPUT_DIR,
      `compose-${String(index + 1).padStart(2, "0")}__${sanitizedPath}${extension}`
    )
  );
}

function buildGeneratedOverrideComposeFilePath(serviceName: string): string {
  const sanitizedServiceName = sanitizeFrozenPath(serviceName).replace(/\//g, "__");
  return normalizeRelativePath(
    join(FROZEN_COMPOSE_INPUT_DIR, `compose-override__${sanitizedServiceName}.yaml`)
  );
}

function resolveFrozenComposeFiles(
  payload: FrozenComposeInputsPayload
): FrozenComposeFilePayload[] {
  if (Array.isArray(payload.composeFiles) && payload.composeFiles.length > 0) {
    return payload.composeFiles;
  }

  return payload.composeFile ? [payload.composeFile] : [];
}

function resolveFrozenComposeProfiles(payload: FrozenComposeInputsPayload): string[] {
  return normalizeComposeProfiles(payload.profiles);
}

function resolveRenderedComposePayload(
  payload: FrozenComposeInputsPayload,
  fallbackContents: string
): { path: string; contents: string } {
  return (
    payload.renderedCompose ?? {
      path: RENDERED_COMPOSE_FILE_NAME,
      contents: fallbackContents
    }
  );
}

function buildImageOverrideComposeDoc(
  imageOverride?: ComposeImageOverrideRequest
): Record<string, unknown> | null {
  const serviceName = imageOverride?.serviceName?.trim();
  const imageReference = imageOverride?.imageReference?.trim();
  if (!serviceName || !imageReference) {
    return null;
  }

  return {
    services: {
      [serviceName]: {
        image: imageReference
      }
    }
  };
}

function validateRequestedComposeProfiles(
  doc: Record<string, unknown>,
  requestedProfiles: string[]
): void {
  if (requestedProfiles.length === 0) {
    return;
  }

  const services =
    doc.services && typeof doc.services === "object" && !Array.isArray(doc.services)
      ? (doc.services as Record<string, unknown>)
      : {};
  const availableProfiles = new Set<string>();

  for (const value of Object.values(services)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const profiles = (value as Record<string, unknown>).profiles;
    if (!Array.isArray(profiles)) {
      continue;
    }

    for (const profile of profiles) {
      if (typeof profile === "string" && profile.trim().length > 0) {
        availableProfiles.add(profile.trim());
      }
    }
  }

  const unsupportedProfiles = requestedProfiles.filter(
    (profile) => !availableProfiles.has(profile)
  );
  if (unsupportedProfiles.length > 0) {
    throw new Error(
      `Compose profiles not found in the staged compose files: ${unsupportedProfiles.join(", ")}.`
    );
  }
}

function materializeEnvFileReferences(input: {
  workDir: string;
  composeFile: string;
  doc: Record<string, unknown>;
  warnings: string[];
  envFilesBySource: Map<string, FrozenComposeEnvFilePayload>;
}): void {
  const services =
    input.doc.services &&
    typeof input.doc.services === "object" &&
    !Array.isArray(input.doc.services)
      ? (input.doc.services as Record<string, unknown>)
      : null;

  for (const [serviceName, references] of collectServiceEnvFileReferences(input.doc).entries()) {
    const serviceValue = services?.[serviceName];
    if (!serviceValue || typeof serviceValue !== "object" || Array.isArray(serviceValue)) {
      continue;
    }

    const service = serviceValue as Record<string, unknown>;
    const rewrittenEnvFile: Array<string | Record<string, unknown>> = [];

    for (const reference of references) {
      const resolvedPath = resolveComposeRelativePath(
        input.workDir,
        input.composeFile,
        reference.path
      );
      if (!existsSync(resolvedPath)) {
        if (reference.required) {
          throw new Error(
            `Compose env_file "${reference.path}" referenced by service "${serviceName}" was not found.`
          );
        }

        input.warnings.push(
          `Skipped optional env_file "${reference.path}" for service "${serviceName}" because it was not present in the frozen workspace.`
        );
        continue;
      }

      const existing = input.envFilesBySource.get(reference.path);
      if (existing) {
        if (!existing.services.includes(serviceName)) {
          existing.services.push(serviceName);
          existing.services.sort((a, b) => a.localeCompare(b));
        }
      } else {
        input.envFilesBySource.set(reference.path, {
          path: buildFrozenEnvFilePath(reference.path),
          sourcePath: normalizeRelativePath(reference.path),
          contents: readFileSync(resolvedPath, "utf8"),
          services: [serviceName]
        });
      }

      const frozenPath =
        input.envFilesBySource.get(reference.path)?.path ?? buildFrozenEnvFilePath(reference.path);
      if (reference.format || !reference.required) {
        const record: Record<string, unknown> = { path: frozenPath };
        if (!reference.required) {
          record.required = false;
        }
        if (reference.format) {
          record.format = reference.format;
        }
        rewrittenEnvFile.push(record);
      } else {
        rewrittenEnvFile.push(frozenPath);
      }
    }

    if (rewrittenEnvFile.length === 0) {
      delete service.env_file;
    } else if (rewrittenEnvFile.length === 1 && typeof rewrittenEnvFile[0] === "string") {
      service.env_file = rewrittenEnvFile[0];
    } else {
      service.env_file = rewrittenEnvFile;
    }
  }
}

function buildManifestFromFrozenInputs(input: {
  frozenInputs: FrozenComposeInputsPayload;
  composeEnvFileContents: string;
  provenance: ComposeInputManifestProvenance;
  repoDefaultContent?: string | null;
  primaryComposeFileSourcePath: string;
  warnings: string[];
}): ComposeInputManifest {
  const composeFiles = resolveFrozenComposeFiles(input.frozenInputs);
  const renderedCompose = resolveRenderedComposePayload(
    input.frozenInputs,
    composeFiles.map((composeFile) => composeFile.contents).join("\n")
  );
  const entries: ComposeInputManifestEntry[] = [
    ...composeFiles.map((composeFile) =>
      buildManifestEntry({
        kind: "compose-file",
        path: composeFile.path,
        sourcePath: composeFile.sourcePath,
        contents: composeFile.contents,
        provenance: "daoflow-generated"
      })
    ),
    buildManifestEntry({
      kind: "rendered-compose-file",
      path: renderedCompose.path,
      contents: renderedCompose.contents,
      provenance: "daoflow-generated"
    }),
    buildManifestEntry({
      kind: "compose-env",
      path: COMPOSE_ENV_FILE_NAME,
      contents: input.composeEnvFileContents,
      provenance: "daoflow-generated"
    })
  ];

  if (input.repoDefaultContent) {
    entries.push(
      buildManifestEntry({
        kind: "repo-default-env",
        path: normalizeRelativePath(join(dirname(input.primaryComposeFileSourcePath), ".env")),
        contents: input.repoDefaultContent,
        provenance: input.provenance
      })
    );
  }

  for (const envFile of input.frozenInputs.envFiles) {
    entries.push(
      buildManifestEntry({
        kind: "service-env-file",
        path: envFile.path,
        sourcePath: envFile.sourcePath,
        contents: envFile.contents,
        provenance: "daoflow-generated",
        services: envFile.services
      })
    );
  }

  return {
    status: "materialized",
    version: 1,
    warnings: input.warnings,
    entries: entries.sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`))
  };
}

export function materializeFrozenComposeInputs(
  workDir: string,
  payload: FrozenComposeInputsPayload
): string[] {
  const composeFiles = resolveFrozenComposeFiles(payload);
  const renderedCompose = resolveRenderedComposePayload(
    payload,
    composeFiles.map((composeFile) => composeFile.contents).join("\n")
  );

  for (const composeFile of composeFiles) {
    writeFrozenFile(workDir, composeFile.path, composeFile.contents);
  }

  writeFrozenFile(workDir, renderedCompose.path, renderedCompose.contents);

  for (const envFile of payload.envFiles) {
    writeFrozenFile(workDir, envFile.path, envFile.contents);
  }

  return composeFiles.map((composeFile) => composeFile.path);
}

function materializeComposeInputsFromExistingPayload(input: {
  workDir: string;
  composeEnvFileContents: string;
  existingManifest?: ComposeInputManifest;
  existingFrozenInputs: FrozenComposeInputsPayload;
  existingBuildPlan?: ComposeBuildPlan;
  imageOverride?: ComposeImageOverrideRequest;
}): MaterializedComposeInputs {
  const warnings = [
    ...(input.existingManifest?.warnings ?? input.existingBuildPlan?.warnings ?? [])
  ];
  const persistedComposeFiles = resolveFrozenComposeFiles(input.existingFrozenInputs).filter(
    (composeFile) => composeFile.sourcePath !== null
  );
  const docs = persistedComposeFiles.map((composeFile) =>
    parseComposeDocument(composeFile.contents)
  );
  const overrideDoc = buildImageOverrideComposeDoc(input.imageOverride);
  const composeFiles = [...persistedComposeFiles];

  if (overrideDoc) {
    composeFiles.push({
      path: buildGeneratedOverrideComposeFilePath(input.imageOverride?.serviceName ?? "service"),
      sourcePath: null,
      contents: stringifyYaml(overrideDoc)
    });
    docs.push(overrideDoc);
  }

  const mergedDoc = mergeComposeDocuments(docs);
  const requestedProfiles = resolveFrozenComposeProfiles(input.existingFrozenInputs);
  validateRequestedComposeProfiles(mergedDoc, requestedProfiles);
  const renderedComposeContents = stringifyYaml(mergedDoc);
  const frozenInputs: FrozenComposeInputsPayload = {
    composeFiles,
    composeFile: composeFiles[0],
    envFiles: input.existingFrozenInputs.envFiles,
    profiles: requestedProfiles,
    renderedCompose: {
      path: RENDERED_COMPOSE_FILE_NAME,
      contents: renderedComposeContents
    }
  };
  const materializedComposeFiles = materializeFrozenComposeInputs(input.workDir, frozenInputs);
  const buildPlan = buildComposeBuildPlan(mergedDoc, warnings);
  const primaryComposeSourcePath =
    persistedComposeFiles[0]?.sourcePath ??
    input.existingManifest?.entries[0]?.sourcePath ??
    "docker-compose.yml";
  const manifest = buildManifestFromFrozenInputs({
    frozenInputs,
    composeEnvFileContents: input.composeEnvFileContents,
    provenance: "daoflow-generated",
    repoDefaultContent: null,
    primaryComposeFileSourcePath: primaryComposeSourcePath,
    warnings
  });

  const preservedRepoDefaultEntries =
    input.existingManifest?.entries.filter((entry) => entry.kind === "repo-default-env") ?? [];
  if (preservedRepoDefaultEntries.length > 0) {
    manifest.entries = [...manifest.entries, ...preservedRepoDefaultEntries].sort((a, b) =>
      `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)
    );
  }

  return {
    composeFile: materializedComposeFiles[0] ?? RENDERED_COMPOSE_FILE_NAME,
    composeFiles: materializedComposeFiles,
    buildPlan,
    manifest,
    frozenInputs
  };
}

export function materializeComposeInputs(input: {
  workDir: string;
  composeFiles?: string[];
  composeFile?: string;
  composeProfiles?: string[];
  sourceProvenance: Exclude<ComposeInputManifestProvenance, "daoflow-generated">;
  repoDefaultContent?: string | null;
  composeEnvFileContents: string;
  existingManifest?: ComposeInputManifest;
  existingFrozenInputs?: FrozenComposeInputsPayload;
  existingBuildPlan?: ComposeBuildPlan;
  imageOverride?: ComposeImageOverrideRequest;
}): MaterializedComposeInputs {
  const composeFiles =
    input.composeFiles && input.composeFiles.length > 0
      ? input.composeFiles
      : input.composeFile
        ? [input.composeFile]
        : [];

  if (composeFiles.length === 0) {
    throw new Error("At least one compose file is required to materialize compose inputs.");
  }

  if (input.existingFrozenInputs) {
    return materializeComposeInputsFromExistingPayload({
      workDir: input.workDir,
      composeEnvFileContents: input.composeEnvFileContents,
      existingManifest: input.existingManifest,
      existingFrozenInputs: input.existingFrozenInputs,
      existingBuildPlan: input.existingBuildPlan,
      imageOverride: input.imageOverride
    });
  }

  const warnings: string[] = [];
  const envFilesBySource = new Map<string, FrozenComposeEnvFilePayload>();
  const frozenComposeFiles: FrozenComposeFilePayload[] = [];
  const composeDocs: Record<string, unknown>[] = [];

  for (const [index, composeFile] of composeFiles.entries()) {
    const composePath = join(input.workDir, composeFile);
    const originalComposeContents = readFileSync(composePath, "utf8");
    const doc = parseComposeDocument(originalComposeContents);
    warnings.push(
      ...rewriteComposeBuildAndSecretReferences({
        doc,
        workDir: input.workDir,
        composeFile
      })
    );
    materializeEnvFileReferences({
      workDir: input.workDir,
      composeFile,
      doc,
      warnings,
      envFilesBySource
    });

    const contents = stringifyYaml(doc);
    frozenComposeFiles.push({
      path: buildFrozenComposeFilePath(composeFile, index),
      sourcePath: normalizeRelativePath(composeFile),
      contents
    });
    composeDocs.push(doc);
  }

  const overrideDoc = buildImageOverrideComposeDoc(input.imageOverride);
  if (overrideDoc) {
    frozenComposeFiles.push({
      path: buildGeneratedOverrideComposeFilePath(input.imageOverride?.serviceName ?? "service"),
      sourcePath: null,
      contents: stringifyYaml(overrideDoc)
    });
    composeDocs.push(overrideDoc);
  }

  const requestedProfiles = normalizeComposeProfiles(input.composeProfiles);
  const mergedDoc = mergeComposeDocuments(composeDocs);
  validateRequestedComposeProfiles(mergedDoc, requestedProfiles);
  const renderedComposeContents = stringifyYaml(mergedDoc);
  const frozenInputs: FrozenComposeInputsPayload = {
    composeFiles: frozenComposeFiles,
    composeFile: frozenComposeFiles[0],
    envFiles: [...envFilesBySource.values()].sort((a, b) => a.path.localeCompare(b.path)),
    profiles: requestedProfiles,
    renderedCompose: {
      path: RENDERED_COMPOSE_FILE_NAME,
      contents: renderedComposeContents
    }
  };
  const materializedComposeFiles = materializeFrozenComposeInputs(input.workDir, frozenInputs);
  const buildPlan = buildComposeBuildPlan(mergedDoc, warnings);
  const manifest = buildManifestFromFrozenInputs({
    frozenInputs,
    composeEnvFileContents: input.composeEnvFileContents,
    provenance: input.sourceProvenance,
    repoDefaultContent: input.repoDefaultContent,
    primaryComposeFileSourcePath: composeFiles[0] ?? "docker-compose.yml",
    warnings
  });

  return {
    composeFile: materializedComposeFiles[0] ?? RENDERED_COMPOSE_FILE_NAME,
    composeFiles: materializedComposeFiles,
    buildPlan,
    manifest,
    frozenInputs
  };
}
