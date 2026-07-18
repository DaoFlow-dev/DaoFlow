import { createHash } from "node:crypto";
import type { ComposePreviewRequestInput } from "./compose-preview";
import { classifyPreviewOrigin, isImmutableCommitSha, type PreviewOrigin } from "./preview-trust";

type ProviderType = "github" | "gitlab";

interface GitHubPullRequestEvent {
  action?: string;
  number?: number;
  repository?: { full_name?: string };
  installation?: {
    account?: {
      login?: string;
    };
  };
  pull_request?: {
    number?: number;
    merged?: boolean;
    head?: {
      ref?: string;
      sha?: string;
      repo?: {
        full_name?: string;
      } | null;
    };
    author_association?: string;
    user?: {
      login?: string;
    };
  };
  sender?: { login?: string };
}

interface GitLabMergeRequestEvent {
  object_kind?: string;
  event_type?: string;
  project?: { path_with_namespace?: string; id?: number };
  source?: { path_with_namespace?: string };
  user?: { username?: string; name?: string };
  user_name?: string;
  object_attributes?: {
    iid?: number;
    action?: string;
    state?: string;
    source_branch?: string;
    source_project_id?: number;
    target_project_id?: number;
    source_project_path?: string;
    source?: {
      path_with_namespace?: string;
    };
    last_commit?: {
      id?: string;
    };
  };
}

export interface PreviewWebhookLifecycleRequest {
  repoFullName: string;
  eventAction: string;
  requestedByEmail: string;
  commitSha: string;
  origin: PreviewOrigin;
  preview: ComposePreviewRequestInput;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function buildWebhookDeliveryKey(input: {
  providerType: ProviderType;
  headerValue?: string | null;
  rawBody: string;
}) {
  const headerValue = readNonEmptyString(input.headerValue);
  if (headerValue) {
    return headerValue;
  }

  const digest = createHash("sha256").update(input.rawBody).digest("hex");
  return `${input.providerType}-${digest}`;
}

export function readGitHubPreviewLifecycle(
  payload: GitHubPullRequestEvent
): PreviewWebhookLifecycleRequest | null {
  const repoFullName = readNonEmptyString(payload.repository?.full_name);
  const branch = readNonEmptyString(payload.pull_request?.head?.ref);
  const commitSha = readNonEmptyString(payload.pull_request?.head?.sha) ?? "";
  const pullRequestNumber = payload.number ?? payload.pull_request?.number;
  const action = readNonEmptyString(payload.action);

  if (!repoFullName || !branch || !pullRequestNumber || !action) {
    return null;
  }

  const previewAction =
    action === "opened" || action === "synchronize" || action === "reopened"
      ? "deploy"
      : action === "closed"
        ? "destroy"
        : null;
  if (!previewAction) {
    return null;
  }
  if (previewAction === "deploy" && !isImmutableCommitSha(commitSha)) {
    return null;
  }

  return {
    repoFullName,
    eventAction: action === "closed" && payload.pull_request?.merged === true ? "merged" : action,
    requestedByEmail:
      readNonEmptyString(payload.sender?.login) ??
      readNonEmptyString(payload.pull_request?.user?.login) ??
      "github-webhook",
    commitSha,
    origin: classifyPreviewOrigin({
      providerType: "github",
      baseRepository: repoFullName,
      sourceRepository: readNonEmptyString(payload.pull_request?.head?.repo?.full_name),
      authorAssociation: readNonEmptyString(payload.pull_request?.author_association),
      installationOwner: readNonEmptyString(payload.installation?.account?.login),
      installationVerified: false,
      protectedSecretsAttached: true
    }),
    preview: {
      target: "pull-request",
      branch,
      pullRequestNumber,
      action: previewAction
    }
  };
}

export function readGitLabPreviewLifecycle(
  payload: GitLabMergeRequestEvent
): PreviewWebhookLifecycleRequest | null {
  if (payload.object_kind !== "merge_request" && payload.event_type !== "merge_request") {
    return null;
  }

  const repoFullName = readNonEmptyString(payload.project?.path_with_namespace);
  const attributes = payload.object_attributes;
  const branch = readNonEmptyString(attributes?.source_branch);
  const pullRequestNumber = attributes?.iid;
  const action = readNonEmptyString(attributes?.action) ?? readNonEmptyString(attributes?.state);

  if (!repoFullName || !branch || !pullRequestNumber || !action) {
    return null;
  }

  const previewAction =
    action === "open" || action === "update" || action === "reopen"
      ? "deploy"
      : action === "merge" || action === "close"
        ? "destroy"
        : null;
  if (!previewAction) {
    return null;
  }
  const commitSha = readNonEmptyString(attributes?.last_commit?.id) ?? "";
  if (previewAction === "deploy" && !isImmutableCommitSha(commitSha)) {
    return null;
  }

  const sourceProjectId = attributes?.source_project_id;
  const targetProjectId = attributes?.target_project_id ?? payload.project?.id;
  const sourceRepository =
    readNonEmptyString(attributes?.source?.path_with_namespace) ??
    readNonEmptyString(attributes?.source_project_path) ??
    readNonEmptyString(payload.source?.path_with_namespace) ??
    (sourceProjectId !== undefined && sourceProjectId === targetProjectId ? repoFullName : null);

  return {
    repoFullName,
    eventAction: action,
    requestedByEmail:
      readNonEmptyString(payload.user?.username) ??
      readNonEmptyString(payload.user_name) ??
      readNonEmptyString(payload.user?.name) ??
      "gitlab-webhook",
    commitSha,
    origin: classifyPreviewOrigin({
      providerType: "gitlab",
      baseRepository: repoFullName,
      sourceRepository,
      repositoryRelationship:
        sourceProjectId !== undefined && targetProjectId !== undefined
          ? sourceProjectId === targetProjectId
            ? "same-repository"
            : "fork"
          : undefined,
      authorAssociation: null,
      installationOwner: null,
      installationVerified: false,
      protectedSecretsAttached: true
    }),
    preview: {
      target: "pull-request",
      branch,
      pullRequestNumber,
      action: previewAction
    }
  };
}
