import { dirname, isAbsolute, relative, resolve } from "node:path";
import type {
  ComposeBuildContextType,
  ComposeBuildPlanSecretDefinition
} from "./compose-build-plan-types";

export function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readServices(doc: Record<string, unknown>): Record<string, unknown> {
  return readObject(doc.services) ?? {};
}

export function readTopLevelSecrets(doc: Record<string, unknown>): Record<string, unknown> {
  return readObject(doc.secrets) ?? {};
}

export function isExternalReference(value: unknown): boolean {
  return value === true || Boolean(readObject(value));
}

function isRemoteReference(value: string): boolean {
  return (
    value.includes("://") ||
    value.startsWith("git@") ||
    value.startsWith("service:") ||
    value.startsWith("docker-image:")
  );
}

export function classifyBuildReference(value: string): ComposeBuildContextType {
  if (value.startsWith("service:")) {
    return "service";
  }

  if (value.startsWith("docker-image:")) {
    return "docker-image";
  }

  if (isRemoteReference(value)) {
    return "remote-url";
  }

  return "local-path";
}

export function resolveTopLevelSecretDefinition(
  sourceName: string,
  topLevelSecrets: Record<string, unknown>
): Omit<ComposeBuildPlanSecretDefinition, "name" | "external"> {
  const secret = readObject(topLevelSecrets[sourceName]);
  if (!secret) {
    return {
      provider: "unknown",
      reference: null
    };
  }

  if (typeof secret.file === "string") {
    return {
      provider: "file",
      reference: secret.file
    };
  }

  if (typeof secret.environment === "string") {
    return {
      provider: "environment",
      reference: secret.environment
    };
  }

  if (isExternalReference(secret.external)) {
    return {
      provider: "external",
      reference: typeof secret.name === "string" ? secret.name : sourceName
    };
  }

  return {
    provider: "unknown",
    reference: null
  };
}

function resolveWorkspaceRelativePath(input: {
  workDir: string;
  composeFile: string;
  path: string;
  label: string;
}): string {
  if (isAbsolute(input.path)) {
    throw new Error(`${input.label} "${input.path}" must stay within the deployment workspace.`);
  }

  const resolvedWorkDir = resolve(input.workDir);
  const composeDir = dirname(input.composeFile);
  const resolvedTarget =
    composeDir === "." || composeDir === ""
      ? resolve(resolvedWorkDir, input.path)
      : resolve(resolvedWorkDir, composeDir, input.path);
  const workspaceRelative = relative(resolvedWorkDir, resolvedTarget);

  if (
    workspaceRelative.startsWith("../") ||
    workspaceRelative === ".." ||
    isAbsolute(workspaceRelative)
  ) {
    throw new Error(`${input.label} "${input.path}" resolves outside of the deployment workspace.`);
  }

  return normalizeRelativePath(workspaceRelative || ".");
}

export function rewriteLocalReference(input: {
  workDir: string;
  composeFile: string;
  value: string;
  label: string;
}): string {
  return classifyBuildReference(input.value) === "local-path"
    ? resolveWorkspaceRelativePath({
        workDir: input.workDir,
        composeFile: input.composeFile,
        path: input.value,
        label: input.label
      })
    : input.value;
}
