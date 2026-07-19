import { eq } from "drizzle-orm";
import { db } from "../connection";
import { approvalActionDispatches, approvalRequests } from "../schema/audit";
import { queueBackupRestore } from "./backup-restores";
import { queueExternalArtifactRestore } from "./external-backup-artifacts";
import {
  claimNextApprovalActionDispatch,
  getApprovalDispatchRetryConfig,
  markApprovalActionDispatchDispatched,
  markApprovalActionDispatchFailure,
  TerminalApprovalDispatchError,
  type ClaimedApprovalDispatch
} from "./approval-dispatch-claim";
import { queueComposeRelease } from "./compose";
import { resolveMemberRoleForTeam } from "./teams";
import { triggerDeploy } from "./trigger-deploy";
import { hashApprovalActionPayload, type ApprovalActionPayload } from "./approval-dispatch-types";

type ApprovalDispatchTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { TerminalApprovalDispatchError } from "./approval-dispatch-claim";
export {
  claimNextApprovalActionDispatch,
  getApprovalDispatchRetryConfig,
  nextApprovalDispatchRetryAt,
  retryApprovalActionDispatch
} from "./approval-dispatch-claim";

export async function createApprovalActionDispatchIntent(
  tx: ApprovalDispatchTransaction,
  input: {
    id: string;
    requestId: string;
    teamId: string;
    actionType: string;
    idempotencyKey: string;
    operationId: string;
    actionPayload: ApprovalActionPayload;
    now: Date;
  }
) {
  const [dispatch] = await tx
    .insert(approvalActionDispatches)
    .values({
      id: input.id,
      approvalRequestId: input.requestId,
      teamId: input.teamId,
      actionType: input.actionType,
      idempotencyKey: input.idempotencyKey,
      operationId: input.operationId,
      payloadVersion: input.actionPayload.version,
      payloadHash: hashApprovalActionPayload(input.actionPayload),
      actionPayload: input.actionPayload,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: input.now,
      createdAt: input.now,
      updatedAt: input.now
    })
    .returning();
  if (!dispatch) throw new Error("Approval dispatch intent could not be persisted.");
  return dispatch;
}

async function ensureApprovalStillExecutable(
  dispatch: ClaimedApprovalDispatch,
  payload: ApprovalActionPayload
) {
  if (
    dispatch.payloadVersion !== payload.version ||
    dispatch.payloadHash !== hashApprovalActionPayload(payload)
  ) {
    throw new TerminalApprovalDispatchError("The durable approval payload integrity check failed.");
  }
  const actorRole = await resolveMemberRoleForTeam(payload.actor.userId, dispatch.teamId);
  if (actorRole !== "owner" && actorRole !== "admin") {
    throw new TerminalApprovalDispatchError(
      "The approving actor no longer has decision authority for this team."
    );
  }
  const [request] = await db
    .select({
      status: approvalRequests.status,
      teamId: approvalRequests.teamId,
      actionType: approvalRequests.actionType,
      targetResource: approvalRequests.targetResource
    })
    .from(approvalRequests)
    .where(eq(approvalRequests.id, dispatch.approvalRequestId))
    .limit(1);
  if (
    !request ||
    request.status !== "approved" ||
    request.teamId !== dispatch.teamId ||
    request.actionType !== dispatch.actionType ||
    request.targetResource !== payload.targetResource
  ) {
    throw new TerminalApprovalDispatchError(
      "The approved action no longer matches its durable approval binding."
    );
  }
}

function dispatchFailureFromResult(result: { status: string; message?: string }) {
  const message = result.message ?? `Dispatch returned ${result.status}.`;
  return result.status === "provider_unavailable"
    ? new Error(message)
    : new TerminalApprovalDispatchError(message);
}

export async function executeApprovalActionDispatch(
  dispatch: ClaimedApprovalDispatch
): Promise<void> {
  const payload = dispatch.payload;
  if (!payload)
    throw new TerminalApprovalDispatchError("The durable approval action payload is invalid.");
  await ensureApprovalStillExecutable(dispatch, payload);
  if (payload.actionType === "invalid") throw new TerminalApprovalDispatchError(payload.reason);

  if (payload.actionType === "compose-release") {
    const deployment = await queueComposeRelease({
      composeServiceId: payload.composeServiceId,
      commitSha: payload.commitSha,
      imageTag: payload.imageTag,
      requestedByUserId: payload.actor.userId,
      requestedByEmail: payload.actor.email,
      requestedByRole: payload.actor.role,
      teamId: dispatch.teamId,
      operationId: dispatch.operationId,
      approvalRequestId: dispatch.approvalRequestId,
      approvalDispatchId: dispatch.id,
      preserveDispatchRetry: true,
      approvalSnapshot: payload.snapshot
    });
    if (!deployment) {
      throw new TerminalApprovalDispatchError(
        "The approved Compose release target is no longer available to this team."
      );
    }
    return;
  }
  if (payload.actionType === "backup-restore") {
    const restore = await queueBackupRestore(
      payload.backupRunId,
      payload.actor.userId,
      payload.actor.email,
      payload.actor.role,
      {
        teamId: dispatch.teamId,
        approvalRequestId: dispatch.approvalRequestId,
        operationId: dispatch.operationId,
        approvalDispatchId: dispatch.id,
        preserveDispatchRetry: true,
        approvalSnapshot: payload.snapshot
      }
    );
    if (!restore) {
      throw new TerminalApprovalDispatchError(
        "The approved backup restore target no longer belongs to this team or is no longer restorable."
      );
    }
    return;
  }
  if (payload.actionType === "external-artifact-restore") {
    const restore = await queueExternalArtifactRestore({
      artifactId: payload.artifactId,
      targetVolumeId: payload.targetVolumeId,
      teamId: dispatch.teamId,
      actor: payload.actor,
      approvalRequestId: dispatch.approvalRequestId,
      operationId: dispatch.operationId,
      approvalDispatchId: dispatch.id,
      preserveDispatchRetry: true,
      approvalSnapshot: payload.snapshot
    });
    if (!restore) {
      throw new TerminalApprovalDispatchError(
        "The approved external artifact restore target is no longer verified or available to this team."
      );
    }
    return;
  }
  const result = await triggerDeploy({
    serviceId: payload.binding.serviceId,
    commitSha: payload.binding.commitSha,
    preview: {
      target: payload.binding.preview.target,
      branch: payload.binding.preview.branch,
      action: payload.binding.preview.action,
      ...(payload.binding.preview.pullRequestNumber !== null
        ? { pullRequestNumber: payload.binding.preview.pullRequestNumber }
        : {})
    },
    previewProviderType: payload.binding.providerType,
    previewAuthorization: { kind: "approval", approvalRequestId: dispatch.approvalRequestId },
    requestedByUserId: payload.actor.userId,
    requestedByEmail: payload.actor.email,
    requestedByRole: payload.actor.role,
    trigger: "webhook",
    teamId: dispatch.teamId,
    operationId: dispatch.operationId,
    approvalRequestId: dispatch.approvalRequestId,
    approvalDispatchId: dispatch.id,
    preserveDispatchRetry: true,
    approvalSnapshot: payload.snapshot
  });
  if (result.status !== "ok") throw dispatchFailureFromResult(result);
}

export async function processNextApprovalActionDispatch(input?: {
  now?: Date;
  leaseDurationMs?: number;
  maxAttempts?: number;
  retryConfig?: ReturnType<typeof getApprovalDispatchRetryConfig>;
  random?: () => number;
  execute?: (dispatch: ClaimedApprovalDispatch) => Promise<void>;
}) {
  const now = input?.now ?? new Date();
  const claimed = await claimNextApprovalActionDispatch({
    now,
    leaseDurationMs: input?.leaseDurationMs
  });
  if (!claimed) return null;
  try {
    await (input?.execute ?? executeApprovalActionDispatch)(claimed);
    const dispatch = await markApprovalActionDispatchDispatched({
      dispatchId: claimed.id,
      leaseToken: claimed.leaseToken ?? "",
      now
    });
    return dispatch ? { status: "dispatched" as const, dispatch } : { status: "stale" as const };
  } catch (error) {
    const dispatch = await markApprovalActionDispatchFailure({
      dispatchId: claimed.id,
      leaseToken: claimed.leaseToken ?? "",
      error,
      now,
      maxAttempts: input?.maxAttempts ?? getApprovalDispatchRetryConfig().maxAttempts,
      retryConfig: input?.retryConfig,
      random: input?.random
    });
    return dispatch ? { status: dispatch.status, dispatch } : { status: "stale" as const };
  }
}

export { reconcileApprovalActionDispatches } from "./approval-dispatch-reconciliation";
