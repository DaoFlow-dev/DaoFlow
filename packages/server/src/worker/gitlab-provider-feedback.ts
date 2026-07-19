import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { resolveGitLabInstallationApiAccess } from "../db/services/gitlab-installation-auth";
import { resolveGitProviderCaForProvider } from "../db/services/git-provider-ca-trust";
import { resolveGitLabApiBaseUrl } from "../db/services/gitlab-urls";
import type { ProviderFeedbackContext } from "../db/services/provider-feedback-types";
import {
  encodeGitLabProjectPath,
  setGitLabCommitStatus,
  type GitLabProviderFeedbackClient
} from "./gitlab-provider-feedback-api";
import { upsertGitLabPreviewNote } from "./gitlab-provider-feedback-note";
import { buildDaoFlowDeploymentUrl, resolveVerifiedPreviewUrl } from "./provider-feedback-url";
import {
  registerProviderFeedbackAdapter,
  type ProviderFeedbackAdapter,
  type ProviderFeedbackAdapterInput
} from "./provider-feedback-adapter-registry";
import {
  ProviderFeedbackDeliveryError,
  ProviderFeedbackSkippedError
} from "./provider-feedback-processor";

type GitLabCommitStatusState = "pending" | "running" | "success" | "failed" | "canceled";

interface LinkedGitLabTarget {
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect;
}

function normalizedRepositoryFullName(value: string | null) {
  const parts = value?.trim().split("/") ?? [];
  if (parts.length < 2 || parts.some((part) => !part.trim())) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitLab feedback requires a linked repository.",
      retryable: false
    });
  }
  return parts.map((part) => part.trim()).join("/");
}

function requireCommitSha(value: string | null) {
  const commitSha = value?.trim() ?? "";
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitLab feedback requires an immutable commit SHA.",
      retryable: false
    });
  }
  return commitSha;
}

function deploymentBranch(context: ProviderFeedbackContext) {
  return context.preview?.branch?.trim() || context.deployment.branch?.trim() || null;
}

function mergeRequestIid(context: ProviderFeedbackContext) {
  const preview = context.preview;
  return preview?.target === "pull-request" &&
    typeof preview.pullRequestNumber === "number" &&
    Number.isInteger(preview.pullRequestNumber) &&
    preview.pullRequestNumber > 0
    ? preview.pullRequestNumber
    : null;
}

function statusNameSegment(value: string | null | undefined, fallback: string) {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

/** A target-specific name lets GitLab update one commit-status context across transitions. */
export function gitLabCommitStatusName(input: { targetId: string; serviceName?: string | null }) {
  return `daoflow/${statusNameSegment(input.serviceName, "deployment")}/${statusNameSegment(
    input.targetId,
    "target"
  )}`;
}

export function mapGitLabCommitStatusState(input: {
  transition: string;
  context: ProviderFeedbackContext;
}): GitLabCommitStatusState {
  if (input.transition === "queued") return "pending";
  if (input.transition === "completed") return "success";
  if (input.transition === "failed") return "failed";
  if (input.transition === "cancelled") return "canceled";
  return "running";
}

function gitLabStatusDescription(state: GitLabCommitStatusState, cleanup: boolean) {
  if (cleanup) {
    const label =
      state === "pending"
        ? "queued for cleanup"
        : state === "running"
          ? "being cleaned up"
          : state === "success"
            ? "cleaned up"
            : state === "failed"
              ? "cleanup failed"
              : "cleanup canceled";
    return `DaoFlow preview is ${label}.`;
  }
  const label = state === "pending" ? "queued" : state === "running" ? "in progress" : state;
  return `DaoFlow deployment is ${label}.`;
}

async function loadLinkedGitLabTarget(input: ProviderFeedbackAdapterInput) {
  const installationId = input.context.repository.installationId;
  if (!installationId) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitLab feedback requires an active linked installation.",
      retryable: false
    });
  }

  const [target] = await db
    .select({ provider: gitProviders, installation: gitInstallations })
    .from(gitProviders)
    .innerJoin(
      gitInstallations,
      and(
        eq(gitInstallations.providerId, gitProviders.id),
        eq(gitInstallations.teamId, gitProviders.teamId)
      )
    )
    .innerJoin(
      projects,
      and(
        eq(projects.id, input.context.project.id),
        eq(projects.teamId, gitProviders.teamId),
        eq(projects.gitProviderId, gitProviders.id),
        eq(projects.gitInstallationId, gitInstallations.id)
      )
    )
    .where(
      and(
        eq(gitProviders.id, input.provider.id),
        eq(gitProviders.teamId, input.teamId),
        eq(gitProviders.type, "gitlab"),
        eq(gitProviders.status, "active"),
        eq(gitInstallations.id, installationId),
        eq(gitInstallations.providerId, input.provider.id),
        eq(gitInstallations.status, "active")
      )
    )
    .limit(1);
  if (!target) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitLab feedback provider or installation is no longer active.",
      retryable: false
    });
  }
  return target satisfies LinkedGitLabTarget;
}

async function gitLabClient(input: ProviderFeedbackAdapterInput, target: LinkedGitLabTarget) {
  let apiAccess: Awaited<ReturnType<typeof resolveGitLabInstallationApiAccess>>;
  let ca: Awaited<ReturnType<typeof resolveGitProviderCaForProvider>>;
  try {
    apiAccess = await resolveGitLabInstallationApiAccess({
      provider: target.provider,
      installation: target.installation
    });
    ca = await resolveGitProviderCaForProvider(target.provider);
  } catch {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitLab installation authentication could not be refreshed.",
      retryable: true
    });
  }

  if (apiAccess.status === "capability_unavailable") {
    throw new ProviderFeedbackSkippedError(
      "GitLab deploy-token credentials are clone-only; commit status and merge-request feedback were skipped."
    );
  }
  if (apiAccess.status !== "ok") {
    throw new ProviderFeedbackSkippedError(
      "GitLab API-capable credentials are unavailable; commit status and merge-request feedback were skipped."
    );
  }

  return {
    apiBaseUrl: resolveGitLabApiBaseUrl(target.provider),
    headers: apiAccess.headers,
    ca,
    signal: input.signal
  } satisfies GitLabProviderFeedbackClient;
}

export const gitLabProviderFeedbackAdapter: ProviderFeedbackAdapter = {
  providerKind: "gitlab",
  async upsertFeedback(input) {
    const repositoryFullName = normalizedRepositoryFullName(input.context.repository.fullName);
    const commitSha = requireCommitSha(input.context.deployment.commitSha);
    const repositoryPath = encodeGitLabProjectPath(repositoryFullName);
    const target = await loadLinkedGitLabTarget(input);
    const client = await gitLabClient(input, target);
    const state = mapGitLabCommitStatusState({
      transition: input.transition,
      context: input.context
    });
    const cleanup = input.context.preview?.action === "destroy";
    const deploymentUrl = buildDaoFlowDeploymentUrl(input.deploymentId);
    const environmentUrl = await resolveVerifiedPreviewUrl({
      teamId: input.teamId,
      context: input.context,
      includePreviewUrl: state === "success"
    });
    const externalStatusId = await setGitLabCommitStatus({
      client,
      repositoryPath,
      commitSha,
      state,
      name: gitLabCommitStatusName({
        targetId: input.targetId,
        serviceName: input.context.deployment.serviceName
      }),
      branch: deploymentBranch(input.context),
      targetUrl: deploymentUrl,
      description: gitLabStatusDescription(state, cleanup)
    });

    const iid = mergeRequestIid(input.context);
    const currentCommentId =
      iid === null
        ? undefined
        : await upsertGitLabPreviewNote({
            client,
            teamId: input.teamId,
            projectId: input.context.project.id,
            providerId: input.provider.id,
            repositoryFullName,
            repositoryPath,
            mergeRequestIid: iid,
            state,
            cleanup,
            deploymentUrl,
            environmentUrl
          });
    const externalCommentId = currentCommentId ?? input.externalIds.externalCommentId;

    return {
      externalStatusId,
      ...(externalCommentId ? { externalCommentId } : {})
    };
  }
};

export function registerGitLabProviderFeedbackAdapter() {
  return registerProviderFeedbackAdapter(gitLabProviderFeedbackAdapter);
}
