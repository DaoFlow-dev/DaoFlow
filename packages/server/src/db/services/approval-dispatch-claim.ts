import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { approvalActionDispatches, auditEntries } from "../schema/audit";
import { newId } from "./json-helpers";
import {
  readApprovalActionPayload,
  type ApprovalActionPayload,
  type ApprovalDispatchStatus
} from "./approval-dispatch-types";

const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 1_000;

type ApprovalDispatchTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ApprovalDispatchRow = typeof approvalActionDispatches.$inferSelect;

export type ClaimedApprovalDispatch = ApprovalDispatchRow & {
  payload: ApprovalActionPayload | null;
};

export class TerminalApprovalDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalApprovalDispatchError";
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getApprovalDispatchRetryConfig() {
  return {
    maxAttempts: readPositiveInteger(
      process.env.DAOFLOW_APPROVAL_DISPATCH_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS
    ),
    baseDelayMs: readPositiveInteger(
      process.env.DAOFLOW_APPROVAL_DISPATCH_RETRY_BASE_MS,
      DEFAULT_RETRY_BASE_MS
    ),
    maxDelayMs: readPositiveInteger(
      process.env.DAOFLOW_APPROVAL_DISPATCH_RETRY_MAX_MS,
      DEFAULT_RETRY_MAX_MS
    )
  };
}

export function nextApprovalDispatchRetryAt(
  attemptCount: number,
  now: Date,
  config = getApprovalDispatchRetryConfig(),
  random = Math.random
) {
  const exponential = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * 2 ** Math.max(0, attemptCount - 1)
  );
  return new Date(now.getTime() + Math.floor(random() * exponential));
}

function safeErrorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.slice(0, MAX_ERROR_LENGTH);
}

function auditMetadata(dispatch: ApprovalDispatchRow, detail: string) {
  return {
    teamId: dispatch.teamId,
    resourceType: "approval-action-dispatch",
    resourceId: dispatch.id,
    resourceLabel: `Approval dispatch ${dispatch.id}`,
    approvalRequestId: dispatch.approvalRequestId,
    approvalDispatchId: dispatch.id,
    operationId: dispatch.operationId,
    actionType: dispatch.actionType,
    detail
  };
}

async function requireActiveLease(
  tx: ApprovalDispatchTransaction,
  input: { dispatchId: string; leaseToken: string; now: Date }
) {
  const [dispatch] = await tx
    .select()
    .from(approvalActionDispatches)
    .where(eq(approvalActionDispatches.id, input.dispatchId))
    .limit(1)
    .for("update");
  if (
    !dispatch ||
    !dispatch.leaseExpiresAt ||
    dispatch.leaseToken !== input.leaseToken ||
    dispatch.leaseExpiresAt.getTime() <= input.now.getTime()
  ) {
    return null;
  }
  return dispatch;
}

export async function claimNextApprovalActionDispatch(input?: {
  now?: Date;
  leaseDurationMs?: number;
}) {
  const now = input?.now ?? new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + (input?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS)
  );
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(approvalActionDispatches)
      .where(
        and(
          inArray(approvalActionDispatches.status, ["pending", "retrying"]),
          lte(approvalActionDispatches.nextAttemptAt, now),
          or(
            isNull(approvalActionDispatches.leaseExpiresAt),
            lte(approvalActionDispatches.leaseExpiresAt, now)
          )
        )
      )
      .orderBy(asc(approvalActionDispatches.nextAttemptAt), asc(approvalActionDispatches.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    const [claimed] = await tx
      .update(approvalActionDispatches)
      .set({
        status: candidate.attemptCount > 0 ? "retrying" : "pending",
        attemptCount: candidate.attemptCount + 1,
        leaseToken: newId(),
        leaseExpiresAt,
        updatedAt: now
      })
      .where(eq(approvalActionDispatches.id, candidate.id))
      .returning();
    return claimed
      ? ({
          ...claimed,
          payload: readApprovalActionPayload(claimed.actionPayload)
        } satisfies ClaimedApprovalDispatch)
      : null;
  });
}

export async function markApprovalActionDispatchDispatched(input: {
  dispatchId: string;
  leaseToken: string;
  now: Date;
}) {
  return db.transaction(async (tx) => {
    const dispatch = await requireActiveLease(tx, input);
    if (!dispatch) return null;
    const [updated] = await tx
      .update(approvalActionDispatches)
      .set({
        status: "dispatched",
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: input.now,
        lastError: null,
        dispatchedAt: input.now,
        updatedAt: input.now
      })
      .where(eq(approvalActionDispatches.id, dispatch.id))
      .returning();
    if (!updated) return null;
    const summary = `Submitted approved ${updated.actionType} operation ${updated.operationId}.`;
    await tx.insert(auditEntries).values({
      actorType: "system",
      actorId: "approval-dispatch-monitor",
      actorEmail: "system@daoflow.local",
      actorRole: "agent",
      targetResource: `approval-dispatch/${updated.id}`,
      action: "approval.dispatch.dispatched",
      inputSummary: summary,
      permissionScope: "approvals:decide",
      outcome: "success",
      metadata: auditMetadata(updated, summary)
    });
    return updated;
  });
}

export async function markApprovalActionDispatchFailure(input: {
  dispatchId: string;
  leaseToken: string;
  error: unknown;
  now: Date;
  maxAttempts: number;
  retryConfig?: ReturnType<typeof getApprovalDispatchRetryConfig>;
  random?: () => number;
}) {
  return db.transaction(async (tx) => {
    const dispatch = await requireActiveLease(tx, input);
    if (!dispatch) return null;
    const terminal =
      input.error instanceof TerminalApprovalDispatchError ||
      dispatch.attemptCount >= input.maxAttempts;
    const status: ApprovalDispatchStatus = terminal ? "terminal-failure" : "retrying";
    const detail = safeErrorMessage(input.error);
    const [updated] = await tx
      .update(approvalActionDispatches)
      .set({
        status,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: terminal
          ? input.now
          : nextApprovalDispatchRetryAt(
              dispatch.attemptCount,
              input.now,
              input.retryConfig,
              input.random
            ),
        lastError: detail,
        completedAt: terminal ? input.now : null,
        updatedAt: input.now
      })
      .where(eq(approvalActionDispatches.id, dispatch.id))
      .returning();
    if (!updated) return null;
    const action = terminal ? "approval.dispatch.terminal_failure" : "approval.dispatch.retry";
    const summary = terminal
      ? `Approval dispatch reached terminal failure: ${detail}`
      : `Approval dispatch will retry: ${detail}`;
    await tx.insert(auditEntries).values({
      actorType: "system",
      actorId: "approval-dispatch-monitor",
      actorEmail: "system@daoflow.local",
      actorRole: "agent",
      targetResource: `approval-dispatch/${updated.id}`,
      action,
      inputSummary: summary,
      permissionScope: "approvals:decide",
      outcome: terminal ? "failure" : "retry",
      metadata: auditMetadata(updated, summary)
    });
    return updated;
  });
}

export async function retryApprovalActionDispatch(input: {
  requestId: string;
  teamId: string;
  userId: string;
  email: string;
  role: AppRole;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [dispatch] = await tx
      .select()
      .from(approvalActionDispatches)
      .where(
        and(
          eq(approvalActionDispatches.approvalRequestId, input.requestId),
          eq(approvalActionDispatches.teamId, input.teamId)
        )
      )
      .limit(1)
      .for("update");
    if (!dispatch) return { status: "not-found" as const };
    if (dispatch.status !== "terminal-failure") return { status: "invalid-state" as const };
    const [updated] = await tx
      .update(approvalActionDispatches)
      .set({
        status: "retrying",
        attemptCount: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: now,
        lastError: null,
        completedAt: null,
        updatedAt: now
      })
      .where(eq(approvalActionDispatches.id, dispatch.id))
      .returning();
    if (!updated) return { status: "not-found" as const };
    const detail = `Operator requeued approved operation ${updated.operationId} with its original operation ID.`;
    await tx.insert(auditEntries).values({
      actorType: "user",
      actorId: input.userId,
      actorEmail: input.email,
      actorRole: input.role,
      targetResource: `approval-dispatch/${updated.id}`,
      action: "approval.dispatch.retry_requested",
      inputSummary: detail,
      permissionScope: "approvals:decide",
      outcome: "success",
      metadata: auditMetadata(updated, detail)
    });
    return { status: "ok" as const, dispatch: updated };
  });
}
