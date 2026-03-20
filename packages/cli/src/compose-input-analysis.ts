import { isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ComposeBuildContextReference {
  serviceName: string;
  context: string;
  dockerfile?: string;
}

export interface ComposeEnvFileReference {
  serviceName: string;
  path: string;
  required: boolean;
  format?: string;
}

export interface ComposeBuildSupportFileReference {
  label: string;
  path: string;
}

export interface ComposeInputAnalysis {
  localBuildContexts: ComposeBuildContextReference[];
  localBuildSupportFiles: ComposeBuildSupportFileReference[];
  localBuildInputCount: number;
  localEnvFiles: ComposeEnvFileReference[];
  requiresContextUpload: boolean;
}

export function detectLocalBuildContexts(composeContent: string): ComposeBuildContextReference[] {
  return analyzeComposeInputs(composeContent).localBuildContexts;
}

export function isLocalComposePath(path: string): boolean {
  if (isAbsolute(path)) {
    return false;
  }

  return path === "." || path.startsWith("./") || path.startsWith("../") || !path.includes(":");
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectLocalAdditionalContexts(
  value: unknown,
  localBuildSupportFiles: Map<string, ComposeBuildSupportFileReference>
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }

      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const contextName = entry.slice(0, separatorIndex).trim();
      const contextPath = entry.slice(separatorIndex + 1).trim();
      if (isLocalComposePath(contextPath)) {
        localBuildSupportFiles.set(`${contextName}\u0000${contextPath}`, {
          label: `build.additional_contexts "${contextName}"`,
          path: contextPath
        });
      }
    }
    return;
  }

  const record = readObject(value);
  if (!record) {
    return;
  }

  for (const [entryName, entryValue] of Object.entries(record)) {
    if (typeof entryValue === "string" && isLocalComposePath(entryValue)) {
      localBuildSupportFiles.set(`${entryName}\u0000${entryValue}`, {
        label: `build.additional_contexts "${entryName}"`,
        path: entryValue
      });
    }
  }
}

function resolveSecretSourceName(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry;
  }

  const record = readObject(entry);
  if (!record) {
    return null;
  }

  return typeof record.source === "string"
    ? record.source
    : typeof record.secret === "string"
      ? record.secret
      : null;
}

function collectLocalBuildSecretFiles(input: {
  secrets: unknown;
  topLevelSecrets: Record<string, unknown>;
  localBuildSupportFiles: Map<string, ComposeBuildSupportFileReference>;
}): void {
  if (!Array.isArray(input.secrets)) {
    return;
  }

  for (const entry of input.secrets) {
    const sourceName = resolveSecretSourceName(entry);
    if (!sourceName) {
      continue;
    }

    const secret = readObject(input.topLevelSecrets[sourceName]);
    if (!secret || typeof secret.file !== "string" || !isLocalComposePath(secret.file)) {
      continue;
    }

    input.localBuildSupportFiles.set(`${sourceName}\u0000${secret.file}`, {
      label: `build.secrets "${sourceName}"`,
      path: secret.file
    });
  }
}

export function analyzeComposeInputs(composeContent: string): ComposeInputAnalysis {
  const doc = parseYaml(composeContent) as Record<string, unknown> | null;
  const localBuildContexts: ComposeBuildContextReference[] = [];
  const localBuildSupportFiles = new Map<string, ComposeBuildSupportFileReference>();
  const localEnvFiles: ComposeEnvFileReference[] = [];
  const topLevelSecrets = readObject(doc?.secrets) ?? {};

  if (!doc?.services) {
    return {
      localBuildContexts,
      localBuildSupportFiles: [],
      localBuildInputCount: 0,
      localEnvFiles,
      requiresContextUpload: false
    };
  }

  for (const [name, svc] of Object.entries(doc.services)) {
    const service = svc as Record<string, unknown>;
    if (typeof service.build === "string") {
      if (isLocalComposePath(service.build)) {
        localBuildContexts.push({ serviceName: name, context: service.build });
      }
    } else if (service.build && typeof service.build === "object") {
      const build = service.build as Record<string, unknown>;
      if (typeof build.context === "string" && isLocalComposePath(build.context)) {
        localBuildContexts.push({
          serviceName: name,
          context: build.context,
          dockerfile: typeof build.dockerfile === "string" ? build.dockerfile : undefined
        });
      }

      collectLocalAdditionalContexts(build.additional_contexts, localBuildSupportFiles);
      collectLocalBuildSecretFiles({
        secrets: build.secrets,
        topLevelSecrets,
        localBuildSupportFiles
      });
    }

    if (typeof service.env_file === "string") {
      if (isLocalComposePath(service.env_file)) {
        localEnvFiles.push({
          serviceName: name,
          path: service.env_file,
          required: true
        });
      }
      continue;
    }

    if (!Array.isArray(service.env_file)) {
      continue;
    }

    for (const entry of service.env_file) {
      if (typeof entry === "string") {
        if (isLocalComposePath(entry)) {
          localEnvFiles.push({
            serviceName: name,
            path: entry,
            required: true
          });
        }
        continue;
      }

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const record = entry as Record<string, unknown>;
      if (typeof record.path !== "string" || !isLocalComposePath(record.path)) {
        continue;
      }

      localEnvFiles.push({
        serviceName: name,
        path: record.path,
        required: record.required !== false,
        format: typeof record.format === "string" ? record.format : undefined
      });
    }
  }

  const localBuildSupportFileList = [...localBuildSupportFiles.values()].sort((a, b) =>
    a.label === b.label ? a.path.localeCompare(b.path) : a.label.localeCompare(b.label)
  );
  const localBuildInputCount = localBuildContexts.length + localBuildSupportFileList.length;

  return {
    localBuildContexts,
    localBuildSupportFiles: localBuildSupportFileList,
    localBuildInputCount,
    localEnvFiles,
    requiresContextUpload: localBuildInputCount > 0 || localEnvFiles.length > 0
  };
}
