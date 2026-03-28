import { matchesComposeEnvBranchPattern } from "../../compose-env";

export type EnvironmentVariableScope = "environment" | "service";
export type EnvironmentVariableCategory = "runtime" | "build";
export type EnvironmentVariableSource = "inline" | "1password";

export interface LayeredEnvironmentVariableRecord {
  id: string;
  scope: EnvironmentVariableScope;
  environmentId: string;
  environmentName: string;
  projectName: string;
  serviceId: string | null;
  serviceName: string | null;
  key: string;
  value: string;
  isSecret: boolean;
  category: EnvironmentVariableCategory;
  source: EnvironmentVariableSource;
  secretRef: string | null;
  branchPattern: string;
  updatedByEmail: string;
  updatedAt: string;
}

export interface EnvironmentVariableInventoryRecord {
  id: string;
  scope: EnvironmentVariableScope;
  scopeLabel: string;
  environmentId: string;
  environmentName: string;
  projectName: string;
  serviceId: string | null;
  serviceName: string | null;
  key: string;
  displayValue: string;
  isSecret: boolean;
  category: EnvironmentVariableCategory;
  source: EnvironmentVariableSource;
  secretRef: string | null;
  branchPattern: string | null;
  statusTone: string;
  statusLabel: string;
  originSummary: string;
  updatedByEmail: string;
  updatedAt: string;
}

export interface ResolvedEnvironmentVariableRecord {
  key: string;
  displayValue: string;
  isSecret: boolean;
  category: EnvironmentVariableCategory;
  source: EnvironmentVariableSource;
  secretRef: string | null;
  scope: EnvironmentVariableScope;
  scopeLabel: string;
  serviceId: string | null;
  serviceName: string | null;
  branchPattern: string | null;
  originSummary: string;
}

function compareResolutionSpecificity(
  left: LayeredEnvironmentVariableRecord,
  right: LayeredEnvironmentVariableRecord
) {
  const leftLiteralLength = left.branchPattern.replaceAll("*", "").length;
  const rightLiteralLength = right.branchPattern.replaceAll("*", "").length;
  if (leftLiteralLength !== rightLiteralLength) {
    return leftLiteralLength - rightLiteralLength;
  }

  if (left.branchPattern.length !== right.branchPattern.length) {
    return left.branchPattern.length - right.branchPattern.length;
  }

  return left.updatedAt.localeCompare(right.updatedAt);
}

export function normalizeStoredBranchPattern(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function readBranchPattern(value: string): string | null {
  return value.length > 0 ? value : null;
}

export function isPreviewScopedBranchPattern(value: string): boolean {
  return value.length > 0;
}

function getEnvironmentVariableStatusTone(isSecret: boolean) {
  return isSecret ? "failed" : "queued";
}

function getEnvironmentVariableStatusLabel(
  isSecret: boolean,
  category: EnvironmentVariableCategory
) {
  if (isSecret) {
    return "Secret";
  }

  return `${category.slice(0, 1).toUpperCase()}${category.slice(1)}`;
}

export function describeEnvironmentVariableOrigin(input: {
  scope: EnvironmentVariableScope;
  branchPattern: string;
}) {
  if (isPreviewScopedBranchPattern(input.branchPattern)) {
    return input.scope === "service" ? "Service preview override" : "Environment preview override";
  }

  return input.scope === "service" ? "Service override" : "Shared environment value";
}

export function describeEnvironmentVariableScope(input: {
  scope: EnvironmentVariableScope;
  branchPattern: string;
}) {
  return describeEnvironmentVariableOrigin(input);
}

export function sortLayeredEnvironmentVariables(
  records: LayeredEnvironmentVariableRecord[]
): LayeredEnvironmentVariableRecord[] {
  return [...records].sort((left, right) => {
    const keyCompare = left.key.localeCompare(right.key);
    if (keyCompare !== 0) {
      return keyCompare;
    }

    const scopeCompare = left.scope === right.scope ? 0 : left.scope === "environment" ? -1 : 1;
    if (scopeCompare !== 0) {
      return scopeCompare;
    }

    const branchCompare = left.branchPattern.localeCompare(right.branchPattern);
    if (branchCompare !== 0) {
      return branchCompare;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function toEnvironmentVariableInventoryRecord(
  record: LayeredEnvironmentVariableRecord,
  canRevealSecrets: boolean
): EnvironmentVariableInventoryRecord {
  return {
    id: record.id,
    scope: record.scope,
    scopeLabel: describeEnvironmentVariableScope(record),
    environmentId: record.environmentId,
    environmentName: record.environmentName,
    projectName: record.projectName,
    serviceId: record.serviceId,
    serviceName: record.serviceName,
    key: record.key,
    displayValue: record.isSecret && !canRevealSecrets ? "[secret]" : record.value,
    isSecret: record.isSecret,
    category: record.category,
    source: record.source,
    secretRef: record.secretRef,
    branchPattern: readBranchPattern(record.branchPattern),
    statusTone: getEnvironmentVariableStatusTone(record.isSecret),
    statusLabel: getEnvironmentVariableStatusLabel(record.isSecret, record.category),
    originSummary: describeEnvironmentVariableOrigin(record),
    updatedByEmail: record.updatedByEmail,
    updatedAt: record.updatedAt
  };
}

function applyResolvedRecord(
  records: Map<string, LayeredEnvironmentVariableRecord>,
  candidates: LayeredEnvironmentVariableRecord[]
) {
  for (const candidate of candidates) {
    records.set(candidate.key, candidate);
  }
}

function sortLayeredEnvironmentVariablesForResolution(
  records: LayeredEnvironmentVariableRecord[]
): LayeredEnvironmentVariableRecord[] {
  return [...records].sort((left, right) => {
    const keyCompare = left.key.localeCompare(right.key);
    if (keyCompare !== 0) {
      return keyCompare;
    }

    return compareResolutionSpecificity(left, right);
  });
}

export function resolveEffectiveEnvironmentVariableRecords(input: {
  records: LayeredEnvironmentVariableRecord[];
  branch?: string | null;
}) {
  const branch = input.branch?.trim() ?? "";
  const baseEnvironment = input.records.filter(
    (record) =>
      record.scope === "environment" && !isPreviewScopedBranchPattern(record.branchPattern)
  );
  const baseService = input.records.filter(
    (record) => record.scope === "service" && !isPreviewScopedBranchPattern(record.branchPattern)
  );
  const previewEnvironment = branch
    ? input.records.filter(
        (record) =>
          record.scope === "environment" &&
          isPreviewScopedBranchPattern(record.branchPattern) &&
          matchesComposeEnvBranchPattern(record.branchPattern, branch)
      )
    : [];
  const previewService = branch
    ? input.records.filter(
        (record) =>
          record.scope === "service" &&
          isPreviewScopedBranchPattern(record.branchPattern) &&
          matchesComposeEnvBranchPattern(record.branchPattern, branch)
      )
    : [];

  const resolved = new Map<string, LayeredEnvironmentVariableRecord>();
  applyResolvedRecord(resolved, sortLayeredEnvironmentVariablesForResolution(baseEnvironment));
  applyResolvedRecord(resolved, sortLayeredEnvironmentVariablesForResolution(baseService));
  applyResolvedRecord(resolved, sortLayeredEnvironmentVariablesForResolution(previewEnvironment));
  applyResolvedRecord(resolved, sortLayeredEnvironmentVariablesForResolution(previewService));

  return [...resolved.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function resolveEffectiveEnvironmentVariables(input: {
  records: LayeredEnvironmentVariableRecord[];
  branch?: string | null;
  canRevealSecrets: boolean;
}): ResolvedEnvironmentVariableRecord[] {
  return resolveEffectiveEnvironmentVariableRecords({
    records: input.records,
    branch: input.branch
  }).map((record) => ({
    key: record.key,
    displayValue: record.isSecret && !input.canRevealSecrets ? "[secret]" : record.value,
    isSecret: record.isSecret,
    category: record.category,
    source: record.source,
    secretRef: record.secretRef,
    scope: record.scope,
    scopeLabel: describeEnvironmentVariableScope(record),
    serviceId: record.serviceId,
    serviceName: record.serviceName,
    branchPattern: readBranchPattern(record.branchPattern),
    originSummary: describeEnvironmentVariableOrigin(record)
  }));
}
