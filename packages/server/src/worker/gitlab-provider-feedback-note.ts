import { createHash } from "node:crypto";
import {
  claimProviderFeedbackPreviewComment,
  releaseProviderFeedbackPreviewComment,
  renewProviderFeedbackPreviewComment
} from "../db/services/provider-feedback-preview-comments";
import {
  createGitLabMergeRequestNote,
  listGitLabMergeRequestNotes,
  updateGitLabMergeRequestNote,
  type GitLabProviderFeedbackClient
} from "./gitlab-provider-feedback-api";
import { ProviderFeedbackDeliveryError } from "./provider-feedback-processor";

type GitLabCommitStatusState = "pending" | "running" | "success" | "failed" | "canceled";
const PREVIEW_NOTE_LEASE_HEARTBEAT_MS = 30_000;

function previewNoteMarker(input: {
  projectId: string;
  repositoryFullName: string;
  mergeRequestIid: number;
}) {
  const identity = [
    input.projectId,
    input.repositoryFullName.toLowerCase(),
    input.mergeRequestIid
  ].join("\n");
  return `<!-- daoflow-preview:${createHash("sha256").update(identity).digest("hex").slice(0, 32)} -->`;
}

function startNoteLeaseHeartbeat(input: {
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
            controller.abort(new Error("GitLab preview note lease was lost."));
          } else if (!stopped) {
            schedule();
          }
        })
        .catch(() => {
          lostLease = true;
          controller.abort(new Error("GitLab preview note lease renewal failed."));
        });
    }, PREVIEW_NOTE_LEASE_HEARTBEAT_MS);
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

function previewStatusLabel(state: GitLabCommitStatusState, cleanup: boolean) {
  if (cleanup) {
    switch (state) {
      case "pending":
        return "cleanup queued";
      case "running":
        return "cleaning up";
      case "success":
        return "cleaned up";
      case "failed":
        return "cleanup failed";
      default:
        return "cleanup canceled";
    }
  }

  switch (state) {
    case "running":
      return "in progress";
    case "success":
      return "ready";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return "queued";
  }
}

export function buildGitLabPreviewNote(input: {
  marker: string;
  state: GitLabCommitStatusState;
  cleanup: boolean;
  deploymentUrl: string | null;
  environmentUrl: string | null;
}) {
  return [
    input.marker,
    "## DaoFlow preview deployment",
    "",
    `Status: ${previewStatusLabel(input.state, input.cleanup)}`,
    input.deploymentUrl
      ? `Deployment: [Open details and logs](${input.deploymentUrl})`
      : "Deployment: DaoFlow",
    input.environmentUrl
      ? `Preview: [Open preview](${input.environmentUrl})`
      : "Preview: not available"
  ].join("\n");
}

function isNotFound(error: unknown) {
  return error instanceof ProviderFeedbackDeliveryError && error.statusCode === 404;
}

async function findMarkedGitLabPreviewNote(input: {
  client: GitLabProviderFeedbackClient;
  repositoryPath: string;
  mergeRequestIid: number;
  marker: string;
}) {
  const notes = await listGitLabMergeRequestNotes(input);
  const found = notes.find((note) => note.body?.includes(input.marker));
  return found?.id === undefined || found.id === null ? null : String(found.id);
}

async function releaseNoteLease(input: {
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
        safeMessage: "GitLab preview note identity needs another retry.",
        retryable: true
      });
    }
  } catch (error) {
    if (error instanceof ProviderFeedbackDeliveryError) throw error;
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "GitLab preview note identity could not be saved.",
      retryable: true
    });
  }
}

/** Creates or updates exactly one durable preview note for a GitLab merge request. */
export async function upsertGitLabPreviewNote(input: {
  client: GitLabProviderFeedbackClient;
  teamId: string;
  projectId: string;
  providerId: string;
  repositoryFullName: string;
  repositoryPath: string;
  mergeRequestIid: number;
  state: GitLabCommitStatusState;
  cleanup: boolean;
  deploymentUrl: string | null;
  environmentUrl: string | null;
}) {
  const marker = previewNoteMarker(input);
  const claim = await claimProviderFeedbackPreviewComment({
    teamId: input.teamId,
    projectId: input.projectId,
    providerId: input.providerId,
    repositoryFullName: input.repositoryFullName,
    pullRequestNumber: input.mergeRequestIid
  });
  if (!claim) {
    throw new ProviderFeedbackDeliveryError({
      safeMessage: "Another GitLab preview update is in progress.",
      retryable: true
    });
  }

  const heartbeat = startNoteLeaseHeartbeat({
    commentId: claim.id,
    leaseToken: claim.leaseToken,
    parentSignal: input.client.signal
  });
  const client = { ...input.client, signal: heartbeat.signal };
  const body = buildGitLabPreviewNote({
    marker,
    state: input.state,
    cleanup: input.cleanup,
    deploymentUrl: input.deploymentUrl,
    environmentUrl: input.environmentUrl
  });
  let externalCommentId = claim.externalCommentId;

  try {
    if (!externalCommentId) {
      externalCommentId = await findMarkedGitLabPreviewNote({
        client,
        repositoryPath: input.repositoryPath,
        mergeRequestIid: input.mergeRequestIid,
        marker
      });
    }

    if (externalCommentId) {
      try {
        externalCommentId = await updateGitLabMergeRequestNote({
          client,
          repositoryPath: input.repositoryPath,
          mergeRequestIid: input.mergeRequestIid,
          noteId: externalCommentId,
          body
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
        externalCommentId = await findMarkedGitLabPreviewNote({
          client,
          repositoryPath: input.repositoryPath,
          mergeRequestIid: input.mergeRequestIid,
          marker
        });
        if (externalCommentId) {
          externalCommentId = await updateGitLabMergeRequestNote({
            client,
            repositoryPath: input.repositoryPath,
            mergeRequestIid: input.mergeRequestIid,
            noteId: externalCommentId,
            body
          });
        }
      }
    }

    if (!externalCommentId) {
      externalCommentId = await createGitLabMergeRequestNote({
        client,
        repositoryPath: input.repositoryPath,
        mergeRequestIid: input.mergeRequestIid,
        body
      });
    }

    if (heartbeat.lostLease()) {
      throw new ProviderFeedbackDeliveryError({
        safeMessage: "GitLab preview note lease was lost.",
        retryable: true
      });
    }
    heartbeat.stop();
    await releaseNoteLease({
      commentId: claim.id,
      leaseToken: claim.leaseToken,
      externalCommentId,
      persist: true
    });
    return externalCommentId;
  } catch (error) {
    heartbeat.stop();
    try {
      await releaseNoteLease({
        commentId: claim.id,
        leaseToken: claim.leaseToken,
        persist: false
      });
    } catch {
      // The feedback retry can recover the marker if the lease cannot be released.
    }
    throw error;
  } finally {
    heartbeat.stop();
  }
}
