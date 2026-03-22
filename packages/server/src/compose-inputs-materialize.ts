import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  buildComposeBuildPlan,
  rewriteComposeBuildAndSecretReferences,
  type ComposeBuildPlan
} from "./compose-build-plan";
import { COMPOSE_ENV_FILE_NAME } from "./compose-env";
import { applyComposeImageOverride, collectServiceEnvFileReferences } from "./compose-inputs-doc";
import {
  buildFrozenEnvFilePath,
  buildManifestEntry,
  materializeFrozenComposeInputs,
  normalizeRelativePath,
  RENDERED_COMPOSE_FILE_NAME,
  resolveComposeRelativePath,
  sortManifestEntries,
  type ComposeImageOverrideRequest,
  type ComposeInputManifest,
  type ComposeInputManifestEntry,
  type ComposeInputManifestProvenance,
  type FrozenComposeEnvFilePayload,
  type FrozenComposeInputsPayload,
  type MaterializedComposeInputs
} from "./compose-inputs-shared";

interface MaterializeComposeInputsOptions {
  workDir: string;
  composeFile: string;
  sourceProvenance: Exclude<ComposeInputManifestProvenance, "daoflow-generated">;
  repoDefaultContent?: string | null;
  composeEnvFileContents: string;
  existingManifest?: ComposeInputManifest;
  existingFrozenInputs?: FrozenComposeInputsPayload;
  existingBuildPlan?: ComposeBuildPlan;
  imageOverride?: ComposeImageOverrideRequest;
}

function buildManifestFromFrozenInputs(input: {
  composeEnvFileContents: string;
  existingManifest?: ComposeInputManifest;
  frozenInputs: FrozenComposeInputsPayload;
}): ComposeInputManifest {
  const preservedEntries =
    input.existingManifest?.entries.filter((entry) => entry.kind === "repo-default-env") ?? [];
  const entries = [
    buildManifestEntry({
      kind: "compose-file",
      path: input.frozenInputs.composeFile.path,
      sourcePath: input.frozenInputs.composeFile.sourcePath,
      contents: input.frozenInputs.composeFile.contents,
      provenance: "daoflow-generated"
    }),
    ...input.frozenInputs.envFiles.map((envFile) =>
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
    }),
    ...preservedEntries
  ];

  return {
    status: "materialized",
    version: 1,
    warnings: [...(input.existingManifest?.warnings ?? [])],
    entries: sortManifestEntries(entries)
  };
}

function materializeExistingFrozenComposeInputs(
  input: MaterializeComposeInputsOptions
): MaterializedComposeInputs {
  const doc =
    (parseYaml(input.existingFrozenInputs?.composeFile.contents ?? "") as Record<
      string,
      unknown
    > | null) ?? {};
  applyComposeImageOverride(doc, input.imageOverride);
  const buildPlan = buildComposeBuildPlan(doc, input.existingBuildPlan?.warnings ?? []);
  const frozenInputs: FrozenComposeInputsPayload = {
    composeFile: {
      ...(input.existingFrozenInputs as FrozenComposeInputsPayload).composeFile,
      contents: stringifyYaml(doc)
    },
    envFiles: (input.existingFrozenInputs as FrozenComposeInputsPayload).envFiles
  };

  return {
    composeFile: materializeFrozenComposeInputs(input.workDir, frozenInputs),
    buildPlan,
    manifest: buildManifestFromFrozenInputs({
      composeEnvFileContents: input.composeEnvFileContents,
      existingManifest: input.existingManifest,
      frozenInputs
    }),
    frozenInputs
  };
}

function buildFreshComposeManifest(input: {
  composeFile: string;
  composeEnvFileContents: string;
  frozenInputs: FrozenComposeInputsPayload;
  renderedComposeContents: string;
  repoDefaultContent?: string | null;
  sourceProvenance: Exclude<ComposeInputManifestProvenance, "daoflow-generated">;
  warnings: string[];
}): ComposeInputManifest {
  const entries: ComposeInputManifestEntry[] = [
    buildManifestEntry({
      kind: "compose-file",
      path: RENDERED_COMPOSE_FILE_NAME,
      sourcePath: input.composeFile,
      contents: input.renderedComposeContents,
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
    entries: sortManifestEntries(entries)
  };
}

function materializeFreshComposeInputs(
  input: MaterializeComposeInputsOptions
): MaterializedComposeInputs {
  const composePath = join(input.workDir, input.composeFile);
  const originalComposeContents = readFileSync(composePath, "utf8");
  const doc = (parseYaml(originalComposeContents) as Record<string, unknown> | null) ?? {};
  const buildWarnings = rewriteComposeBuildAndSecretReferences({
    doc,
    workDir: input.workDir,
    composeFile: input.composeFile
  });
  applyComposeImageOverride(doc, input.imageOverride);
  const buildPlan = buildComposeBuildPlan(doc, buildWarnings);
  const services =
    doc.services && typeof doc.services === "object" && !Array.isArray(doc.services)
      ? (doc.services as Record<string, unknown>)
      : null;
  const envFileReferences = collectServiceEnvFileReferences(doc);
  const warnings: string[] = [...buildWarnings];
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

  const renderedComposeContents = stringifyYaml(doc);
  const frozenInputs: FrozenComposeInputsPayload = {
    composeFile: {
      path: RENDERED_COMPOSE_FILE_NAME,
      sourcePath: normalizeRelativePath(input.composeFile),
      contents: renderedComposeContents
    },
    envFiles: [...envFilesBySource.values()].sort((a, b) => a.path.localeCompare(b.path))
  };

  return {
    composeFile: materializeFrozenComposeInputs(input.workDir, frozenInputs),
    buildPlan,
    manifest: buildFreshComposeManifest({
      composeFile: input.composeFile,
      composeEnvFileContents: input.composeEnvFileContents,
      frozenInputs,
      renderedComposeContents,
      repoDefaultContent: input.repoDefaultContent,
      sourceProvenance: input.sourceProvenance,
      warnings
    }),
    frozenInputs
  };
}

export function materializeComposeInputs(
  input: MaterializeComposeInputsOptions
): MaterializedComposeInputs {
  if (input.existingFrozenInputs) {
    return materializeExistingFrozenComposeInputs(input);
  }

  return materializeFreshComposeInputs(input);
}
