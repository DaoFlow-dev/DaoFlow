import { createHash } from "node:crypto";
import {
  claimProviderFeedbackPreviewComment,
  releaseProviderFeedbackPreviewComment,
  renewProviderFeedbackPreviewComment
} from "../db/services/provider-feedback-preview-comments";
import { ProviderFeedbackDeliveryError } from "./provider-feedback-processor";
import {
  createGitHubIssueComment,
  listGitHubIssueComments,
  updateGitHubIssueComment,
  type GitHubProviderFeedbackClient
} from "./github-provider-feedback-api";

type GitHubDeploymentState = "queued" | "in_progress" | "success" | "failure" | "inactive";
const PREVIEW_COMMENT_LEASE_HEARTBEAT_MS = 30_000;

function previewCommentMarker(input: {
  projectId: string;
  repositoryFullName: string;
  pullRequestNumber: number;
}) {
  const identity = [
    input.projectId,
    input.repositoryFullName.toLowerCase(),
    input.pullRequestNumber
  ].join("\n");
  return `<!-- daoflow-preview:${createHash("sha256").update(identity).digest("hex").slice(0, 32)} -->`;
}

function startCommentLeaseHeartbeat(input: {
  commentId: string;
  leaseToken: string;
  parentSignal: AbortSignal;
}) {
  const controller = new AbortController();
  let lostLease = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const abortFromParent = () => controller.abort(input.parentSignal.reason);
  if (input.parentSignal.aborted) abortFromParent();
  else input.parentSignal.addEventListener("abort", abortFromParent, { once: true });

  const schedule = () => {
    timer = setTimeout(() => {
      void renewProviderFeedbackPreviewComment(input)
        .then((active) => {
          if (!active) {
            lostLease = true;
            controller.abort(new Error("GitHub preview comment lease was lost."));
          } else if (!stopped) {
            schedule();
          }
        })
        .catch(() => {
          lostLease = true;
          controller.abort(new Error("GitHub preview comment lease renewal failed."));
        });
    }, PREVIEW_COMMENT_LEASE_HEARTBEAT_MS);
  };
  schedule();

  return {
    signal: controller.signal,
    lostLease: () => lostLease,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      input.parentSignal.removeEventListener("abort", abortFromParent);
    }
  };
}

function previewStatusLabel(state: GitHubDeploymentState) {
  switch (state) {
    case "in_progress":
      return "in progress";
    case "success":
      return "ready";
    case "failure":
      return "failed";
    case "inactive":
      return "inactive";
    default:
      return "queued";
  }
}

export function buildGitHubPreviewComment(input: {
  marker: string;
  state: GitHubDeploymentState;
  deploymentUrl: string | null;
  environmentUrl: string | null;
}) {
  return [
    input.marker,
    "## DaoFlow preview deployment",
    "",
    `Status: ${previewStatusLabel(input.state)}`,
    input.deploymentUrl
      ? `Deployment: [Open details](${input.deploymentUrl})`
      : "Deployment: DaoFlow",
    input.environmentUrl
      ? `Preview: [Open preview](${input.environmentUrl})`
      : "Preview: not available"
  ].join("\n");
}

function isNotFound(error: unknown) {
  return error instanceof ProviderFeedbackDeliveryError && error.statusCode === 404;
}

async function findMarkedGitHubPreviewComment(input: {
  client: GitHubProviderFeedbackClient;
  repositoryPath: string;
  pullRequestNumber: number;
  marker: string;
}) {
  const comments = await listGitHubIssueComments(input);
  const found = comments.find((comment) => comment.body?.includes(input.marker));
  return found?.id === undefined || found.id === null ? null : String(found.id);
}

async function releaseCommentLease(input: {
  commentId: string;
  leaseToken: string;
  externalCommentId?: string | null;
  persist: boolean;
}) {
  try {
    const released = await releaseProviderFeedbackPreviewComment({
      commentId: input.commentId,
      leaseToken: input.leaseToken,
      ...(input.persist ? { externalCommentId: input.externalCommentId } : {})
    });
    if (!released) {
      throw new ProviderFeedbackDeliveryError({
        safeMessage: "GitHub preview comment identity needs another retry.",
        retryable: true
      });
    }
  } catch (error) {
    if (error instanceof ProviderFeedbackDeliveryError) throw error;
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitHub preview comment identity could not be saved.",
      retryable: true
    });
  }
}

/** Creates or updates exactly one durable preview comment for a pull request. */
export async function upsertGitHubPreviewComment(input: {
  client: GitHubProviderFeedbackClient;
  teamId: string;
  projectId: string;
  providerId: string;
  repositoryFullName: string;
  repositoryPath: string;
  pullRequestNumber: number;
  state: GitHubDeploymentState;
  deploymentUrl: string | null;
  environmentUrl: string | null;
}) {
  const marker = previewCommentMarker(input);
  const claim = await claimProviderFeedbackPreviewComment({
    teamId: input.teamId,
    projectId: input.projectId,
    providerId: input.providerId,
    repositoryFullName: input.repositoryFullName,
    pullRequestNumber: input.pullRequestNumber
  });
  if (!claim) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "Another GitHub preview update is in progress.",
      retryable: true
    });
  }

  const heartbeat = startCommentLeaseHeartbeat({
    commentId: claim.id,
    leaseToken: claim.leaseToken,
    parentSignal: input.client.signal
  });
  const client = { ...input.client, signal: heartbeat.signal };

  const body = buildGitHubPreviewComment({
    marker,
    state: input.state,
    deploymentUrl: input.deploymentUrl,
    environmentUrl: input.environmentUrl
  });
  let externalCommentId = claim.externalCommentId;

  try {
    if (!externalCommentId) {
      externalCommentId = await findMarkedGitHubPreviewComment({
        client,
        repositoryPath: input.repositoryPath,
        pullRequestNumber: input.pullRequestNumber,
        marker
      });
    }

    if (externalCommentId) {
      try {
        externalCommentId = await updateGitHubIssueComment({
          client,
          repositoryPath: input.repositoryPath,
          commentId: externalCommentId,
          body
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
        externalCommentId = await findMarkedGitHubPreviewComment({
          client,
          repositoryPath: input.repositoryPath,
          pullRequestNumber: input.pullRequestNumber,
          marker
        });
        if (externalCommentId) {
          externalCommentId = await updateGitHubIssueComment({
            client,
            repositoryPath: input.repositoryPath,
            commentId: externalCommentId,
            body
          });
        }
      }
    }

    if (!externalCommentId) {
      externalCommentId = await createGitHubIssueComment({
        client,
        repositoryPath: input.repositoryPath,
        pullRequestNumber: input.pullRequestNumber,
        body
      });
    }

    if (heartbeat.lostLease()) {
      throw new ProviderFeedbackDeliveryError({
        safeMessage: "GitHub preview comment lease was lost.",
        retryable: true
      });
    }
    heartbeat.stop();
    await releaseCommentLease({
      commentId: claim.id,
      leaseToken: claim.leaseToken,
      externalCommentId,
      persist: true
    });
    return externalCommentId;
  } catch (error) {
    heartbeat.stop();
    try {
      await releaseCommentLease({
        commentId: claim.id,
        leaseToken: claim.leaseToken,
        persist: false
      });
    } catch {
      // The feedback retry will recover the marker if the lease cannot be released.
    }
    throw error;
  } finally {
    heartbeat.stop();
  }
}
