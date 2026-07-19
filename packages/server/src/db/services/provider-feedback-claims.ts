import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../connection";
import { providerFeedback, providerFeedbackTargets } from "../schema/provider-feedback";
import { newId } from "./json-helpers";
import {
  activeProviderFeedbackClaimWhere,
  activeProviderFeedbackTargetClaimWhere,
  requireActiveProviderFeedbackClaim
} from "./provider-feedback-claim-lease";
import type {
  ProviderFeedbackExternalIds,
  ProviderFeedbackFailure,
  ProviderFeedbackState
} from "./provider-feedback-types";

const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 5 * 60_000;
const MAX_SAFE_ERROR_LENGTH = 1_000;

type ProviderFeedbackRow = typeof providerFeedback.$inferSelect;
type ProviderFeedbackTargetRow = typeof providerFeedbackTargets.$inferSelect;

export interface ClaimedProviderFeedback extends ProviderFeedbackRow {
  target: ProviderFeedbackTargetRow;
  externalIds: Required<ProviderFeedbackExternalIds>;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getProviderFeedbackRetryConfig() {
  return {
    maxAttempts: readPositiveInteger(
      process.env.DAOFLOW_PROVIDER_FEEDBACK_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS
    ),
    baseDelayMs: readPositiveInteger(
      process.env.DAOFLOW_PROVIDER_FEEDBACK_RETRY_BASE_MS,
      DEFAULT_RETRY_BASE_MS
    ),
    maxDelayMs: readPositiveInteger(
      process.env.DAOFLOW_PROVIDER_FEEDBACK_RETRY_MAX_MS,
      DEFAULT_RETRY_MAX_MS
    )
  };
}

export function nextProviderFeedbackRetryAt(
  attemptCount: number,
  now: Date,
  config = getProviderFeedbackRetryConfig(),
  retryAfterMs?: number
) {
  const exponentialDelayMs = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * 2 ** Math.max(0, attemptCount - 1)
  );
  const retryDelayMs = Math.max(exponentialDelayMs, retryAfterMs ?? 0);
  return new Date(now.getTime() + retryDelayMs);
}

function safeErrorMessage(value: string) {
  return value.trim().slice(0, MAX_SAFE_ERROR_LENGTH) || "Provider feedback delivery failed.";
}

function normalizeExternalId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 255) : null;
}

function mergedExternalIds(
  target: ProviderFeedbackTargetRow,
  feedback: ProviderFeedbackRow,
  update?: ProviderFeedbackExternalIds
): Required<ProviderFeedbackExternalIds> {
  return {
    externalDeploymentId:
      normalizeExternalId(update?.externalDeploymentId) ??
      feedback.externalDeploymentId ??
      target.externalDeploymentId ??
      null,
    externalStatusId:
      normalizeExternalId(update?.externalStatusId) ??
      feedback.externalStatusId ??
      target.externalStatusId ??
      null,
    externalCommentId:
      normalizeExternalId(update?.externalCommentId) ??
      feedback.externalCommentId ??
      target.externalCommentId ??
      null
  };
}

function earlierOpenFeedbackSql() {
  return sql`NOT EXISTS (
    SELECT 1
    FROM provider_feedback AS earlier_feedback
    WHERE earlier_feedback.target_id = ${providerFeedback.targetId}
      AND earlier_feedback.state IN ('pending', 'retrying', 'dead-letter')
      AND earlier_feedback.sequence < ${providerFeedback.deliverySequence}
  )`;
}

/**
 * Claims one feedback row for a registered provider kind. An unresolved earlier
 * row for the same target blocks later transitions, preserving one external
 * deployment/comment across the lifecycle.
 */
export async function claimNextProviderFeedback(input: {
  providerKinds: readonly string[];
  now?: Date;
  leaseDurationMs?: number;
}): Promise<ClaimedProviderFeedback | null> {
  if (input.providerKinds.length === 0) return null;

  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + (input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS)
  );
  const leaseToken = newId();

  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ feedback: providerFeedback, target: providerFeedbackTargets })
      .from(providerFeedback)
      .innerJoin(providerFeedbackTargets, eq(providerFeedbackTargets.id, providerFeedback.targetId))
      .where(
        and(
          inArray(providerFeedback.state, ["pending", "retrying"]),
          inArray(providerFeedback.providerKind, [...input.providerKinds]),
          lte(providerFeedback.nextAttemptAt, now),
          or(isNull(providerFeedback.leaseExpiresAt), lte(providerFeedback.leaseExpiresAt, now)),
          or(
            isNull(providerFeedbackTargets.leaseExpiresAt),
            lte(providerFeedbackTargets.leaseExpiresAt, now)
          ),
          earlierOpenFeedbackSql()
        )
      )
      .orderBy(asc(providerFeedback.nextAttemptAt), asc(providerFeedback.deliverySequence))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    await tx
      .update(providerFeedbackTargets)
      .set({ leaseToken, leaseExpiresAt, updatedAt: now })
      .where(eq(providerFeedbackTargets.id, candidate.target.id));

    const [feedback] = await tx
      .update(providerFeedback)
      .set({
        state: candidate.feedback.attemptCount > 0 ? "retrying" : "pending",
        attemptCount: candidate.feedback.attemptCount + 1,
        leaseToken,
        leaseExpiresAt,
        updatedAt: now
      })
      .where(eq(providerFeedback.id, candidate.feedback.id))
      .returning();
    if (!feedback) return null;

    const target: ProviderFeedbackTargetRow = {
      ...candidate.target,
      leaseToken,
      leaseExpiresAt,
      updatedAt: now
    };
    return {
      ...feedback,
      target,
      externalIds: mergedExternalIds(target, feedback)
    } satisfies ClaimedProviderFeedback;
  });
}

export async function markProviderFeedbackDelivered(input: {
  feedbackId: string;
  leaseToken: string;
  externalIds?: ProviderFeedbackExternalIds;
  now?: Date;
}) {
  return db.transaction(async (tx) => {
    const claimed = await requireActiveProviderFeedbackClaim(tx, {
      feedbackId: input.feedbackId,
      leaseToken: input.leaseToken,
      now: input.now
    });
    if (!claimed) return null;
    const now = input.now ?? claimed.validationNow;

    const externalIds = mergedExternalIds(claimed.target, claimed.feedback, input.externalIds);
    const [updatedTarget] = await tx
      .update(providerFeedbackTargets)
      .set({
        ...externalIds,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now
      })
      .where(activeProviderFeedbackTargetClaimWhere(claimed))
      .returning({ id: providerFeedbackTargets.id });
    if (!updatedTarget) return null;

    const [delivered] = await tx
      .update(providerFeedback)
      .set({
        state: "delivered",
        ...externalIds,
        leaseToken: null,
        leaseExpiresAt: null,
        safeError: null,
        nextAttemptAt: now,
        deliveredAt: now,
        updatedAt: now
      })
      .where(activeProviderFeedbackClaimWhere(claimed))
      .returning();
    if (!delivered) {
      throw new Error("Provider feedback claim changed while finalizing delivery.");
    }
    return delivered ?? null;
  });
}

export async function renewProviderFeedbackLease(input: {
  feedbackId: string;
  leaseToken: string;
  now?: Date;
  leaseDurationMs?: number;
}) {
  return db.transaction(async (tx) => {
    const claimed = await requireActiveProviderFeedbackClaim(tx, {
      feedbackId: input.feedbackId,
      leaseToken: input.leaseToken,
      now: input.now
    });
    if (!claimed) return false;
    const now = input.now ?? claimed.validationNow;
    const leaseExpiresAt = new Date(
      now.getTime() + (input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS)
    );

    const [updatedTarget] = await tx
      .update(providerFeedbackTargets)
      .set({ leaseExpiresAt, updatedAt: now })
      .where(activeProviderFeedbackTargetClaimWhere(claimed))
      .returning({ id: providerFeedbackTargets.id });
    if (!updatedTarget) return false;
    const [updatedFeedback] = await tx
      .update(providerFeedback)
      .set({ leaseExpiresAt, updatedAt: now })
      .where(activeProviderFeedbackClaimWhere(claimed))
      .returning({ id: providerFeedback.id });
    if (!updatedFeedback) {
      throw new Error("Provider feedback claim changed while renewing its lease.");
    }
    return true;
  });
}

export async function markProviderFeedbackFailure(input: {
  feedbackId: string;
  leaseToken: string;
  failure: ProviderFeedbackFailure;
  now?: Date;
  maxAttempts?: number;
  retryConfig?: ReturnType<typeof getProviderFeedbackRetryConfig>;
}) {
  const retryConfig = input.retryConfig ?? getProviderFeedbackRetryConfig();
  const maxAttempts = input.maxAttempts ?? retryConfig.maxAttempts;
  return db.transaction(async (tx) => {
    const claimed = await requireActiveProviderFeedbackClaim(tx, {
      feedbackId: input.feedbackId,
      leaseToken: input.leaseToken,
      now: input.now
    });
    if (!claimed) return null;
    const now = input.now ?? claimed.validationNow;

    const deadLetter = !input.failure.retryable || claimed.feedback.attemptCount >= maxAttempts;
    const state: ProviderFeedbackState = deadLetter ? "dead-letter" : "retrying";
    const [updatedTarget] = await tx
      .update(providerFeedbackTargets)
      .set({ leaseToken: null, leaseExpiresAt: null, updatedAt: now })
      .where(activeProviderFeedbackTargetClaimWhere(claimed))
      .returning({ id: providerFeedbackTargets.id });
    if (!updatedTarget) return null;

    const [updated] = await tx
      .update(providerFeedback)
      .set({
        state,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: deadLetter
          ? now
          : nextProviderFeedbackRetryAt(
              claimed.feedback.attemptCount,
              now,
              retryConfig,
              input.failure.retryAfterMs
            ),
        safeError: safeErrorMessage(input.failure.safeMessage),
        updatedAt: now
      })
      .where(activeProviderFeedbackClaimWhere(claimed))
      .returning();
    if (!updated) {
      throw new Error("Provider feedback claim changed while recording delivery failure.");
    }
    return updated ?? null;
  });
}
