import { createHash } from "node:crypto";
import type { ComposeEnvPayloadEntry } from "./compose-env";

type JsonRecord = Record<string, unknown>;

export type ComposePreviewMode = "branch" | "pull-request" | "any";
export type ComposePreviewTarget = "branch" | "pull-request";
export type ComposePreviewAction = "deploy" | "destroy";

export interface ComposePreviewConfigInput {
  enabled?: boolean;
  mode?: ComposePreviewMode;
  domainTemplate?: string;
  staleAfterHours?: number;
}

export interface ComposePreviewConfig {
  enabled: boolean;
  mode: ComposePreviewMode;
  domainTemplate: string | null;
  staleAfterHours: number | null;
}

export interface ComposePreviewRequestInput {
  target: ComposePreviewTarget;
  branch: string;
  pullRequestNumber?: number;
  action?: ComposePreviewAction;
}

export interface ComposePreviewRequest {
  target: ComposePreviewTarget;
  branch: string;
  pullRequestNumber: number | null;
  action: ComposePreviewAction;
}

export interface ComposePreviewMetadata {
  target: ComposePreviewTarget;
  action: ComposePreviewAction;
  key: string;
  branch: string;
  pullRequestNumber: number | null;
  envBranch: string;
  stackName: string;
  primaryDomain: string | null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normalizeMode(value: unknown): ComposePreviewMode | null {
  return value === "branch" || value === "pull-request" || value === "any" ? value : null;
}

function normalizeTarget(value: unknown): ComposePreviewTarget | null {
  return value === "branch" || value === "pull-request" ? value : null;
}

function normalizeAction(value: unknown): ComposePreviewAction {
  return value === "destroy" ? "destroy" : "deploy";
}

function normalizeStaleAfterHours(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 24 * 30
    ? value
    : null;
}

function truncateWithHash(base: string, suffix: string, limit: number): string {
  const combined = `${base}-${suffix}`;
  if (combined.length <= limit) {
    return combined;
  }

  const hash = createHash("sha1").update(combined).digest("hex").slice(0, 8);
  const reserved = suffix.length + hash.length + 2;
  const trimmedBase = base.slice(0, Math.max(8, limit - reserved)).replace(/-+$/g, "");
  return `${trimmedBase}-${suffix}-${hash}`.slice(0, limit);
}

function renderPreviewDomainTemplate(input: {
  template: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  stackName: string;
  metadata: ComposePreviewMetadata;
}): string | null {
  const tokens: Record<string, string> = {
    project: slugify(input.projectName),
    environment: slugify(input.environmentName),
    service: slugify(input.serviceName),
    branch: input.metadata.branch,
    branchSlug: slugify(input.metadata.branch),
    preview: slugify(input.metadata.key),
    stack: slugify(input.stackName),
    pr:
      input.metadata.pullRequestNumber !== null
        ? String(input.metadata.pullRequestNumber)
        : "branch"
  };

  const rendered = input.template.replace(/\{([a-zA-Z]+)\}/g, (match, token: string) => {
    return Object.prototype.hasOwnProperty.call(tokens, token) ? (tokens[token] ?? "") : match;
  });
  const normalized = rendered
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.-|-\./g, ".")
    .slice(0, 255);

  return normalized.length > 0 ? normalized : null;
}

export function readComposePreviewConfig(value: unknown): ComposePreviewConfig | null {
  const record = asRecord(value);
  if (record.enabled !== true) {
    return null;
  }

  return {
    enabled: true,
    mode: normalizeMode(record.mode) ?? "any",
    domainTemplate: readNonEmptyString(record.domainTemplate),
    staleAfterHours: normalizeStaleAfterHours(record.staleAfterHours)
  };
}

export function readComposePreviewConfigFromConfig(config: unknown): ComposePreviewConfig | null {
  return readComposePreviewConfig(asRecord(config).preview);
}

export function writeComposePreviewConfigToConfig(input: {
  config: unknown;
  preview?: ComposePreviewConfigInput | null;
}): JsonRecord {
  const next = { ...asRecord(input.config) };

  if (input.preview === undefined) {
    const normalized = readComposePreviewConfig(next.preview);
    if (normalized) {
      next.preview = normalized;
    } else {
      delete next.preview;
    }
    return next;
  }

  if (input.preview === null || input.preview.enabled === false) {
    delete next.preview;
    return next;
  }

  const domainTemplate = readNonEmptyString(input.preview.domainTemplate);
  next.preview = {
    enabled: true,
    mode: normalizeMode(input.preview.mode) ?? "any",
    domainTemplate,
    staleAfterHours: normalizeStaleAfterHours(input.preview.staleAfterHours)
  } satisfies ComposePreviewConfig;

  return next;
}

export function normalizeComposePreviewRequest(
  input: ComposePreviewRequestInput
): ComposePreviewRequest {
  const branch = readNonEmptyString(input.branch);
  if (!branch) {
    throw new Error("Preview deployments require a source branch.");
  }

  const target = normalizeTarget(input.target);
  if (!target) {
    throw new Error("Preview deployments must target a branch or pull request.");
  }

  const pullRequestNumber =
    target === "pull-request" && typeof input.pullRequestNumber === "number"
      ? input.pullRequestNumber
      : null;
  if (target === "pull-request" && (!pullRequestNumber || pullRequestNumber < 1)) {
    throw new Error("Pull-request previews require a positive pull request number.");
  }

  return {
    target,
    branch,
    pullRequestNumber,
    action: normalizeAction(input.action)
  };
}

export function previewModeAllowsRequest(
  mode: ComposePreviewMode,
  request: ComposePreviewRequest
): boolean {
  return mode === "any" || mode === request.target;
}

export function deriveComposePreviewMetadata(input: {
  config: ComposePreviewConfig;
  request: ComposePreviewRequest;
  projectName: string;
  environmentName: string;
  serviceName: string;
  baseStackName: string;
}): ComposePreviewMetadata {
  const key =
    input.request.target === "pull-request"
      ? `pr-${input.request.pullRequestNumber}`
      : `branch-${slugify(input.request.branch) || "preview"}`;
  const envBranch =
    input.request.target === "pull-request"
      ? `preview/pr-${input.request.pullRequestNumber}`
      : `preview/${input.request.branch}`;
  const stackSuffix =
    input.request.target === "pull-request"
      ? `pr-${input.request.pullRequestNumber}`
      : slugify(input.request.branch) || "preview";
  const stackName = truncateWithHash(slugify(input.baseStackName) || "preview", stackSuffix, 63);
  const metadata: ComposePreviewMetadata = {
    target: input.request.target,
    action: input.request.action,
    key,
    branch: input.request.branch,
    pullRequestNumber: input.request.pullRequestNumber,
    envBranch,
    stackName,
    primaryDomain: null
  };

  return {
    ...metadata,
    primaryDomain: input.config.domainTemplate
      ? renderPreviewDomainTemplate({
          template: input.config.domainTemplate,
          projectName: input.projectName,
          environmentName: input.environmentName,
          serviceName: input.serviceName,
          stackName,
          metadata
        })
      : null
  };
}

export function buildComposePreviewEnvEntries(
  metadata: ComposePreviewMetadata
): ComposeEnvPayloadEntry[] {
  const entries: ComposeEnvPayloadEntry[] = [
    {
      key: "DAOFLOW_PREVIEW",
      value: "true",
      category: "runtime",
      isSecret: false,
      source: "inline",
      branchPattern: null
    },
    {
      key: "DAOFLOW_PREVIEW_TARGET",
      value: metadata.target,
      category: "runtime",
      isSecret: false,
      source: "inline",
      branchPattern: null
    },
    {
      key: "DAOFLOW_PREVIEW_BRANCH",
      value: metadata.branch,
      category: "runtime",
      isSecret: false,
      source: "inline",
      branchPattern: null
    },
    {
      key: "DAOFLOW_PREVIEW_ENV_BRANCH",
      value: metadata.envBranch,
      category: "runtime",
      isSecret: false,
      source: "inline",
      branchPattern: null
    },
    {
      key: "DAOFLOW_PREVIEW_STACK",
      value: metadata.stackName,
      category: "runtime",
      isSecret: false,
      source: "inline",
      branchPattern: null
    }
  ];

  if (metadata.pullRequestNumber !== null) {
    entries.push({
      key: "DAOFLOW_PREVIEW_PR_NUMBER",
      value: String(metadata.pullRequestNumber),
      category: "runtime",
      isSecret: false,
      source: "inline",
      branchPattern: null
    });
  }

  if (metadata.primaryDomain) {
    entries.push({
      key: "DAOFLOW_PREVIEW_DOMAIN",
      value: metadata.primaryDomain,
      category: "runtime",
      isSecret: false,
      source: "inline",
      branchPattern: null
    });
  }

  return entries;
}

export function readComposePreviewMetadata(value: unknown): ComposePreviewMetadata | null {
  const record = asRecord(value);
  const target = normalizeTarget(record.target);
  const action = normalizeAction(record.action);
  const key = readNonEmptyString(record.key);
  const branch = readNonEmptyString(record.branch);
  const envBranch = readNonEmptyString(record.envBranch);
  const stackName = readNonEmptyString(record.stackName);

  if (!target || !key || !branch || !envBranch || !stackName) {
    return null;
  }

  return {
    target,
    action,
    key,
    branch,
    pullRequestNumber:
      typeof record.pullRequestNumber === "number" && record.pullRequestNumber > 0
        ? record.pullRequestNumber
        : null,
    envBranch,
    stackName,
    primaryDomain: readNonEmptyString(record.primaryDomain)
  };
}
