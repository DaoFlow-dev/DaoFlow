import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ComposeInputAnalysis } from "./compose-input-analysis";

export class ComposeUploadContextValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "ComposeUploadContextValidationError";
  }
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

interface ComposeUploadInputReference {
  label: string;
  path: string;
}

function collectComposeUploadInputReferences(
  composeInputs: ComposeInputAnalysis
): ComposeUploadInputReference[] {
  const references: ComposeUploadInputReference[] = [];

  for (const context of composeInputs.localBuildContexts) {
    references.push({
      label: `build.context for service ${context.serviceName}`,
      path: context.context
    });
  }

  for (const supportFile of composeInputs.localBuildSupportFiles) {
    references.push({
      label: supportFile.label,
      path: supportFile.path
    });
  }

  for (const envFile of composeInputs.localEnvFiles) {
    references.push({
      label: `env_file for service ${envFile.serviceName}`,
      path: envFile.path
    });
  }

  return references;
}

export function validateComposeUploadContextRoot(input: {
  composePath: string;
  contextPath: string;
  composeInputs: ComposeInputAnalysis;
}): string[] {
  if (!input.composeInputs.requiresContextUpload) {
    return [];
  }

  const composeDir = dirname(resolve(input.composePath));
  const contextRoot = resolve(input.contextPath);
  const invalidReferences = collectComposeUploadInputReferences(input.composeInputs)
    .filter((reference) => !isWithinRoot(contextRoot, resolve(composeDir, reference.path)))
    .map(
      (reference) =>
        `${reference.label} (${reference.path}) resolves outside the configured --context root ${input.contextPath}. ` +
        "Widen --context so every local compose input is included in the upload bundle."
    );

  return [...new Set(invalidReferences)];
}

export function assertValidComposeUploadContextRoot(input: {
  composePath: string;
  contextPath: string;
  composeInputs: ComposeInputAnalysis;
}): void {
  const problems = validateComposeUploadContextRoot(input);
  if (problems.length > 0) {
    throw new ComposeUploadContextValidationError(problems);
  }
}
