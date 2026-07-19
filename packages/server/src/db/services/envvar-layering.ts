import { matchesComposeEnvBranchPattern } from "../../compose-env";

export type EnvironmentVariableScope = "project" | "environment" | "service";
export type EnvironmentVariableCategory = "runtime" | "build";
export type EnvironmentVariableSource = "inline" | "1password";
export type EnvironmentVariableOrigin =
  "project" | "environment" | "service" | "preview-environment" | "preview-service";

export interface LayeredEnvironmentVariableRecord {
  id: string;
  scope: EnvironmentVariableScope;
  projectId: string;
  projectName: string;
  environmentId: string | null;
  environmentName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  key: string;
  value: string;
  isSecret: boolean;
  category: EnvironmentVariableCategory;
  source: EnvironmentVariableSource;
  secretRef: string | null;
  branchPattern: string;
  revision: number;
  updatedByEmail: string;
  updatedAt: string;
}

export interface EnvironmentVariableInventoryRecord {
  id: string;
  scope: EnvironmentVariableScope;
  origin: EnvironmentVariableOrigin;
  scopeLabel: string;
  projectId: string;
  projectName: string;
  environmentId: string | null;
  environmentName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  key: string;
  displayValue: string;
  isSecret: boolean;
  category: EnvironmentVariableCategory;
  source: EnvironmentVariableSource;
  secretRef: string | null;
  branchPattern: string | null;
  revision: number;
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
  origin: EnvironmentVariableOrigin;
  scopeLabel: string;
  projectId: string;
  projectName: string;
  environmentId: string | null;
  environmentName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  branchPattern: string | null;
  revision: number;
  originSummary: string;
  overriddenOrigins: EnvironmentVariableOrigin[];
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

export function getEnvironmentVariableOrigin(
  record: Pick<LayeredEnvironmentVariableRecord, "scope" | "branchPattern">
): EnvironmentVariableOrigin {
  if (record.scope === "project") {
    return "project";
  }

  if (isPreviewScopedBranchPattern(record.branchPattern)) {
    return record.scope === "service" ? "preview-service" : "preview-environment";
  }

  return record.scope;
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
  const origin = getEnvironmentVariableOrigin(input);
  const labels: Record<EnvironmentVariableOrigin, string> = {
    project: "Project default",
    environment: "Shared environment value",
    service: "Service override",
    "preview-environment": "Environment preview override",
    "preview-service": "Service preview override"
  };
  return labels[origin];
}

export function describeEnvironmentVariableScope(input: {
  scope: EnvironmentVariableScope;
  branchPattern: string;
}) {
  return describeEnvironmentVariableOrigin(input);
}

function scopeRank(scope: EnvironmentVariableScope) {
  if (scope === "project") return 0;
  return scope === "environment" ? 1 : 2;
}

export function sortLayeredEnvironmentVariables(
  records: LayeredEnvironmentVariableRecord[]
): LayeredEnvironmentVariableRecord[] {
  return [...records].sort((left, right) => {
    const keyCompare = left.key.localeCompare(right.key);
    if (keyCompare !== 0) {
      return keyCompare;
    }

    const scopeCompare = scopeRank(left.scope) - scopeRank(right.scope);
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
  const origin = getEnvironmentVariableOrigin(record);
  return {
    id: record.id,
    scope: record.scope,
    origin,
    scopeLabel: describeEnvironmentVariableScope(record),
    projectId: record.projectId,
    projectName: record.projectName,
    environmentId: record.environmentId,
    environmentName: record.environmentName,
    serviceId: record.serviceId,
    serviceName: record.serviceName,
    key: record.key,
    displayValue: record.isSecret && !canRevealSecrets ? "[secret]" : record.value,
    isSecret: record.isSecret,
    category: record.category,
    source: record.source,
    secretRef: record.secretRef,
    branchPattern: readBranchPattern(record.branchPattern),
    revision: record.revision,
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

function getResolutionLayers(input: {
  records: LayeredEnvironmentVariableRecord[];
  branch?: string | null;
}) {
  const branch = input.branch?.trim() ?? "";
  const project = input.records.filter((record) => record.scope === "project");
  const environment = input.records.filter(
    (record) =>
      record.scope === "environment" && !isPreviewScopedBranchPattern(record.branchPattern)
  );
  const service = input.records.filter(
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

  return [project, environment, service, previewEnvironment, previewService].map(
    sortLayeredEnvironmentVariablesForResolution
  );
}

export function resolveEffectiveEnvironmentVariableRecords(input: {
  records: LayeredEnvironmentVariableRecord[];
  branch?: string | null;
}) {
  const resolved = new Map<string, LayeredEnvironmentVariableRecord>();
  for (const layer of getResolutionLayers(input)) {
    applyResolvedRecord(resolved, layer);
  }

  return [...resolved.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function resolveEffectiveEnvironmentVariables(input: {
  records: LayeredEnvironmentVariableRecord[];
  branch?: string | null;
  canRevealSecrets: boolean;
}): ResolvedEnvironmentVariableRecord[] {
  const resolutionLayers = getResolutionLayers(input);
  const candidates = resolutionLayers.flat();
  return resolveEffectiveEnvironmentVariableRecords(input).map((record) => {
    const origin = getEnvironmentVariableOrigin(record);
    const overriddenOrigins = Array.from(
      new Set(
        candidates
          .filter((candidate) => candidate.key === record.key && candidate.id !== record.id)
          .map(getEnvironmentVariableOrigin)
      )
    );

    return {
      key: record.key,
      displayValue: record.isSecret && !input.canRevealSecrets ? "[secret]" : record.value,
      isSecret: record.isSecret,
      category: record.category,
      source: record.source,
      secretRef: record.secretRef,
      scope: record.scope,
      origin,
      scopeLabel: describeEnvironmentVariableScope(record),
      projectId: record.projectId,
      projectName: record.projectName,
      environmentId: record.environmentId,
      environmentName: record.environmentName,
      serviceId: record.serviceId,
      serviceName: record.serviceName,
      branchPattern: readBranchPattern(record.branchPattern),
      revision: record.revision,
      originSummary: describeEnvironmentVariableOrigin(record),
      overriddenOrigins
    };
  });
}
