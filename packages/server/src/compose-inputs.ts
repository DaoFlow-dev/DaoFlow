import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { COMPOSE_ENV_FILE_NAME } from "./compose-env";

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

export function materializeComposeInputs(input: {
  workDir: string;
  composeFile: string;
  sourceProvenance: Exclude<ComposeInputManifestProvenance, "daoflow-generated">;
  repoDefaultContent?: string | null;
  composeEnvFileContents: string;
  existingManifest?: ComposeInputManifest;
  existingFrozenInputs?: FrozenComposeInputsPayload;
}): MaterializedComposeInputs {
  if (input.existingFrozenInputs) {
    const composeFile = materializeFrozenComposeInputs(input.workDir, input.existingFrozenInputs);
    const manifest = input.existingManifest ?? {
      status: "materialized",
      version: 1,
      warnings: [],
      entries: [
        buildManifestEntry({
          kind: "compose-file",
          path: input.existingFrozenInputs.composeFile.path,
          sourcePath: input.existingFrozenInputs.composeFile.sourcePath,
          contents: input.existingFrozenInputs.composeFile.contents,
          provenance: "daoflow-generated"
        }),
        ...input.existingFrozenInputs.envFiles.map((envFile) =>
          buildManifestEntry({
            kind: "service-env-file",
            path: envFile.path,
            sourcePath: envFile.sourcePath,
            contents: envFile.contents,
            provenance: "daoflow-generated",
            services: envFile.services
          })
        ),
        buildManifestEntry({
          kind: "compose-env",
          path: COMPOSE_ENV_FILE_NAME,
          contents: input.composeEnvFileContents,
          provenance: "daoflow-generated"
        })
      ].sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`))
    };

    return {
      composeFile,
      manifest,
      frozenInputs: input.existingFrozenInputs
    };
  }

  const composePath = join(input.workDir, input.composeFile);
  const originalComposeContents = readFileSync(composePath, "utf8");
  const doc = (parseYaml(originalComposeContents) as Record<string, unknown> | null) ?? {};
  const services =
    doc.services && typeof doc.services === "object" && !Array.isArray(doc.services)
      ? (doc.services as Record<string, unknown>)
      : null;
  const envFileReferences = collectServiceEnvFileReferences(doc);
  const warnings: string[] = [];
  const envFilesBySource = new Map<string, FrozenComposeEnvFilePayload>();

  for (const [serviceName, references] of envFileReferences.entries()) {
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

        warnings.push(
          `Skipped optional env_file "${reference.path}" for service "${serviceName}" because it was not present in the frozen workspace.`
        );
        continue;
      }

      const existing = envFilesBySource.get(reference.path);
      if (existing) {
        if (!existing.services.includes(serviceName)) {
          existing.services.push(serviceName);
          existing.services.sort((a, b) => a.localeCompare(b));
        }
      } else {
        envFilesBySource.set(reference.path, {
          path: buildFrozenEnvFilePath(reference.path),
          sourcePath: normalizeRelativePath(reference.path),
          contents: readFileSync(resolvedPath, "utf8"),
          services: [serviceName]
        });
      }

      const frozenPath =
        envFilesBySource.get(reference.path)?.path ?? buildFrozenEnvFilePath(reference.path);
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

  const renderedComposeFile = RENDERED_COMPOSE_FILE_NAME;
  const renderedComposeContents = stringifyYaml(doc);
  const frozenInputs: FrozenComposeInputsPayload = {
    composeFile: {
      path: renderedComposeFile,
      sourcePath: normalizeRelativePath(input.composeFile),
      contents: renderedComposeContents
    },
    envFiles: [...envFilesBySource.values()].sort((a, b) => a.path.localeCompare(b.path))
  };

  const composeFile = materializeFrozenComposeInputs(input.workDir, frozenInputs);
  const entries: ComposeInputManifestEntry[] = [
    buildManifestEntry({
      kind: "compose-file",
      path: renderedComposeFile,
      sourcePath: input.composeFile,
      contents: renderedComposeContents,
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
        path: normalizeRelativePath(join(dirname(input.composeFile), ".env")),
        contents: input.repoDefaultContent,
        provenance: input.sourceProvenance
      })
    );
  }

  for (const envFile of frozenInputs.envFiles) {
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
    composeFile,
    manifest: {
      status: "materialized",
      version: 1,
      warnings,
      entries: entries.sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`))
    },
    frozenInputs
  };
}
