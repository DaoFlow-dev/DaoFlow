import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ComposePreviewRequest } from "./compose-preview";
import { db } from "./db/connection";
import { approvalRequests } from "./db/schema/audit";
import { projects } from "./db/schema/projects";
import { asRecord, readString } from "./db/services/json-helpers";

export const previewPolicies = ["disabled", "manual-approval"] as const;

export type PreviewPolicy = (typeof previewPolicies)[number];
export type PreviewProviderType = "github" | "gitlab";

export const previewSecretProfile = "project-environment" as const;

export interface PreviewOrigin {
  providerType: PreviewProviderType;
  baseRepository: string;
  sourceRepository: string | null;
  repositoryRelationship: "same-repository" | "fork" | "unknown";
  authorAssociation: string | null;
  installationOwner: string | null;
  installationVerified: boolean;
  protectedSecretsAttached: boolean;
}

export interface PreviewApprovalBinding {
  version: 1;
  providerType: PreviewProviderType;
  providerId: string;
  installationId: string;
  baseRepository: string;
  sourceRepository: string;
  commitSha: string;
  policy: "manual-approval";
  policyRevision: number;
  allowedSecretProfile: typeof previewSecretProfile;
  expiresAt: string;
  origin: PreviewOrigin;
  serviceId: string;
  preview: ComposePreviewRequest;
}

export interface PreviewAuthorization {
  kind: "approval";
  approvalRequestId: string;
}

function normalizeRepository(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase() ?? ""
  );
}

function readNullableString(value: unknown) {
  const parsed = readString({ value }, "value", "");
  return parsed.length > 0 ? parsed : null;
}

function readPreviewProvider(value: unknown): PreviewProviderType | null {
  return value === "github" || value === "gitlab" ? value : null;
}

function readPreviewPolicyValue(value: unknown): PreviewPolicy | null {
  return previewPolicies.includes(value as PreviewPolicy) ? (value as PreviewPolicy) : null;
}

function readPreviewAction(value: unknown): ComposePreviewRequest["action"] | null {
  return value === "deploy" || value === "destroy" ? value : null;
}

function readRepositoryRelationship(
  value: unknown
): PreviewOrigin["repositoryRelationship"] | null {
  return value === "same-repository" || value === "fork" || value === "unknown" ? value : null;
}

function readPreviewOrigin(value: unknown): PreviewOrigin | null {
  const record = asRecord(value);
  const providerType = readPreviewProvider(record.providerType);
  const repositoryRelationship = readRepositoryRelationship(record.repositoryRelationship);
  const baseRepository = readString(record, "baseRepository", "");
  if (!providerType || !repositoryRelationship || !baseRepository) {
    return null;
  }

  return {
    providerType,
    baseRepository,
    sourceRepository: readNullableString(record.sourceRepository),
    repositoryRelationship,
    authorAssociation: readNullableString(record.authorAssociation),
    installationOwner: readNullableString(record.installationOwner),
    installationVerified: record.installationVerified === true,
    protectedSecretsAttached: record.protectedSecretsAttached === true
  };
}

function readPreviewRequest(value: unknown): ComposePreviewRequest | null {
  const record = asRecord(value);
  const target =
    record.target === "pull-request" || record.target === "branch" ? record.target : null;
  const branch = readString(record, "branch", "");
  const action = readPreviewAction(record.action);
  const pullRequestNumber =
    typeof record.pullRequestNumber === "number" && Number.isInteger(record.pullRequestNumber)
      ? record.pullRequestNumber
      : null;

  if (!target || !branch || !action || (target === "pull-request" && !pullRequestNumber)) {
    return null;
  }

  return { target, branch, action, pullRequestNumber };
}

function hasExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = new Date(expiresAt).getTime();
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

export function readPreviewPolicy(value: unknown): PreviewPolicy {
  return readPreviewPolicyValue(value) ?? "manual-approval";
}

export function isImmutableCommitSha(value: string | null | undefined) {
  return /^[a-f0-9]{40}$/i.test(value?.trim() ?? "");
}

export function classifyPreviewOrigin(input: {
  providerType: PreviewProviderType;
  baseRepository: string;
  sourceRepository?: string | null;
  repositoryRelationship?: PreviewOrigin["repositoryRelationship"];
  authorAssociation?: string | null;
  installationOwner?: string | null;
  installationVerified: boolean;
  protectedSecretsAttached: boolean;
}): PreviewOrigin {
  const baseRepository = input.baseRepository.trim();
  const sourceRepository = input.sourceRepository?.trim() || null;
  const normalizedBase = normalizeRepository(baseRepository);
  const normalizedSource = normalizeRepository(sourceRepository);
  const repositoryRelationship =
    input.repositoryRelationship ??
    (normalizedBase && normalizedSource
      ? normalizedBase === normalizedSource
        ? "same-repository"
        : "fork"
      : "unknown");

  return {
    providerType: input.providerType,
    baseRepository,
    sourceRepository,
    repositoryRelationship,
    authorAssociation: input.authorAssociation?.trim() || null,
    installationOwner: input.installationOwner?.trim() || null,
    installationVerified: input.installationVerified,
    protectedSecretsAttached: input.protectedSecretsAttached
  };
}

export function evaluatePreviewPolicy(input: { policy: PreviewPolicy; origin: PreviewOrigin }) {
  if (input.policy === "disabled") {
    return {
      decision: "blocked" as const,
      reason: "Preview deployment is disabled for this project."
    };
  }

  if (input.origin.repositoryRelationship === "fork") {
    return {
      decision: "blocked" as const,
      reason:
        "Fork preview deployment is unavailable until DaoFlow has an isolated preview runner and Compose capability policy."
    };
  }

  if (input.origin.repositoryRelationship !== "same-repository") {
    return {
      decision: "blocked" as const,
      reason:
        "DaoFlow could not verify that the preview source repository matches the configured project."
    };
  }

  if (!input.origin.installationVerified) {
    return {
      decision: "blocked" as const,
      reason: "DaoFlow could not verify that the provider installation owns this project webhook."
    };
  }

  return {
    decision: "approval-required" as const,
    reason:
      "A human must approve this exact pull-request commit before DaoFlow prepares deployment inputs."
  };
}

export function buildPreviewApprovalBinding(input: {
  providerType: PreviewProviderType;
  providerId: string;
  installationId: string;
  sourceRepository: string;
  baseRepository: string;
  commitSha: string;
  policyRevision: number;
  origin: PreviewOrigin;
  serviceId: string;
  preview: ComposePreviewRequest;
  expiresAt?: string;
}): PreviewApprovalBinding {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

  return {
    version: 1,
    providerType: input.providerType,
    providerId: input.providerId,
    installationId: input.installationId,
    sourceRepository: input.sourceRepository,
    baseRepository: input.baseRepository,
    commitSha: input.commitSha,
    policy: "manual-approval",
    policyRevision: input.policyRevision,
    allowedSecretProfile: previewSecretProfile,
    expiresAt,
    origin: input.origin,
    serviceId: input.serviceId,
    preview: input.preview
  };
}

export function readPreviewApprovalBinding(value: unknown): PreviewApprovalBinding | null {
  const record = asRecord(value);
  const providerType = readPreviewProvider(record.providerType);
  const providerId = readString(record, "providerId", "");
  const installationId = readString(record, "installationId", "");
  const policy = readPreviewPolicyValue(record.policy);
  const origin = readPreviewOrigin(record.origin);
  const preview = readPreviewRequest(record.preview);
  const sourceRepository = readString(record, "sourceRepository", "");
  const baseRepository = readString(record, "baseRepository", "");
  const commitSha = readString(record, "commitSha", "");
  const serviceId = readString(record, "serviceId", "");
  const expiresAt = readString(record, "expiresAt", "");

  if (
    record.version !== 1 ||
    !providerType ||
    !providerId ||
    !installationId ||
    policy !== "manual-approval" ||
    !origin ||
    !preview ||
    !sourceRepository ||
    !baseRepository ||
    !isImmutableCommitSha(commitSha) ||
    !serviceId ||
    !Number.isInteger(record.policyRevision) ||
    (record.policyRevision as number) < 1 ||
    record.allowedSecretProfile !== previewSecretProfile ||
    !expiresAt ||
    !Number.isFinite(new Date(expiresAt).getTime())
  ) {
    return null;
  }

  return {
    version: 1,
    providerType,
    providerId,
    installationId,
    sourceRepository,
    baseRepository,
    commitSha,
    policy: "manual-approval",
    policyRevision: record.policyRevision as number,
    allowedSecretProfile: previewSecretProfile,
    expiresAt,
    origin,
    serviceId,
    preview
  };
}

export function buildPreviewApprovalBindingKey(binding: PreviewApprovalBinding): string {
  const canonical = JSON.stringify({
    version: binding.version,
    providerType: binding.providerType,
    providerId: binding.providerId,
    installationId: binding.installationId,
    baseRepository: normalizeRepository(binding.baseRepository),
    sourceRepository: normalizeRepository(binding.sourceRepository),
    commitSha: binding.commitSha.toLowerCase(),
    policy: binding.policy,
    policyRevision: binding.policyRevision,
    allowedSecretProfile: binding.allowedSecretProfile,
    serviceId: binding.serviceId,
    preview: binding.preview
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function readPreviewApprovalExpiry(value: unknown) {
  const binding = readPreviewApprovalBinding(asRecord(value).previewTrust);
  return binding?.expiresAt ?? readNullableString(asRecord(value).expiresAt);
}

function projectRepositoryMatches(project: typeof projects.$inferSelect, repository: string) {
  return normalizeRepository(project.repoFullName) === normalizeRepository(repository);
}

export async function validatePreviewDeploymentAuthorization(input: {
  authorization: PreviewAuthorization | undefined;
  project: typeof projects.$inferSelect;
  serviceId: string;
  providerType: PreviewProviderType | null;
  commitSha: string;
  preview: ComposePreviewRequest;
}) {
  if (!input.authorization || !input.providerType || !isImmutableCommitSha(input.commitSha)) {
    return {
      allowed: false as const,
      reason: "Preview deployment requires an exact approved provider commit."
    };
  }

  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, input.authorization.approvalRequestId),
        eq(approvalRequests.teamId, input.project.teamId)
      )
    )
    .limit(1);
  if (!request || request.status !== "approved") {
    return {
      allowed: false as const,
      reason: "No approved preview request exists for this deployment."
    };
  }

  const summary = asRecord(request.inputSummary);
  const binding = readPreviewApprovalBinding(summary.previewTrust);
  const expiresAt = readPreviewApprovalExpiry(summary);
  const valid =
    binding !== null &&
    !hasExpired(expiresAt) &&
    request.actionType === "preview-deployment" &&
    request.targetResource === `service/${input.serviceId}` &&
    request.resolvedByUserId !== null &&
    request.resolvedByEmail !== null &&
    binding.serviceId === input.serviceId &&
    binding.providerType === input.providerType &&
    binding.providerId === input.project.gitProviderId &&
    binding.installationId === input.project.gitInstallationId &&
    binding.commitSha === input.commitSha &&
    binding.policyRevision === input.project.previewPolicyRevision &&
    input.project.previewPolicy === "manual-approval" &&
    binding.allowedSecretProfile === previewSecretProfile &&
    binding.preview.target === input.preview.target &&
    binding.preview.branch === input.preview.branch &&
    binding.preview.pullRequestNumber === input.preview.pullRequestNumber &&
    binding.preview.action === input.preview.action &&
    binding.origin.providerType === binding.providerType &&
    binding.origin.repositoryRelationship === "same-repository" &&
    binding.origin.installationVerified &&
    binding.origin.baseRepository === binding.baseRepository &&
    binding.origin.sourceRepository === binding.sourceRepository &&
    projectRepositoryMatches(input.project, binding.baseRepository) &&
    projectRepositoryMatches(input.project, binding.sourceRepository);

  return valid
    ? { allowed: true as const, allowedSecretProfile: previewSecretProfile }
    : {
        allowed: false as const,
        reason:
          "The approved preview request no longer matches this project policy, source, or commit."
      };
}
