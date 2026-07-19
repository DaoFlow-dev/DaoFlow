import {
  claimNextProviderFeedback,
  getProviderFeedbackRetryConfig,
  markProviderFeedbackDelivered,
  markProviderFeedbackFailure,
  markProviderFeedbackSkipped,
  renewProviderFeedbackLease
} from "../db/services/provider-feedback-claims";
import type {
  ProviderFeedbackExternalIds,
  ProviderFeedbackFailure
} from "../db/services/provider-feedback-types";
import {
  deliverProviderFeedback,
  getProviderFeedbackAdapter,
  listRegisteredProviderFeedbackKinds
} from "./provider-feedback-adapter-registry";

const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT"
]);
const PROVIDER_FEEDBACK_LEASE_HEARTBEAT_MS = 10_000;

export class ProviderFeedbackDeliveryError extends Error {
  readonly safeMessage: string;
  readonly statusCode: number | null;
  readonly retryAfterMs: number | undefined;
  readonly retryable: boolean | undefined;

  constructor(input: {
    safeMessage: string;
    statusCode?: number | null;
    retryAfterMs?: number;
    retryable?: boolean;
  }) {
    super(input.safeMessage);
    this.name = "ProviderFeedbackDeliveryError";
    this.safeMessage = input.safeMessage;
    this.statusCode = input.statusCode ?? null;
    this.retryAfterMs = input.retryAfterMs;
    this.retryable = input.retryable;
  }
}

/** A provider capability is intentionally unavailable; retain the audit warning and continue. */
export class ProviderFeedbackSkippedError extends Error {
  readonly safeMessage: string;

  constructor(safeMessage: string) {
    super(safeMessage);
    this.name = "ProviderFeedbackSkippedError";
    this.safeMessage = safeMessage;
  }
}

function readStatusCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const value = candidate.statusCode ?? candidate.status;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isNetworkFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    (typeof candidate.code === "string" && NETWORK_ERROR_CODES.has(candidate.code)) ||
    candidate.name === "AbortError"
  );
}

function assertStableExternalIdentity(
  current: Required<ProviderFeedbackExternalIds>,
  update: ProviderFeedbackExternalIds | void
) {
  if (!update) return;
  const stickyIds = [
    ["deployment", current.externalDeploymentId, update.externalDeploymentId],
    ["comment", current.externalCommentId, update.externalCommentId]
  ] as const;
  for (const [label, existing, next] of stickyIds) {
    const normalized = next?.trim() || null;
    if (existing && normalized && existing !== normalized) {
      throw new ProviderFeedbackDeliveryError({
        safeMessage: `Provider feedback ${label} identity changed unexpectedly.`,
        retryable: false
      });
    }
  }
}

function startLeaseHeartbeat(input: { feedbackId: string; leaseToken: string }) {
  const controller = new AbortController();
  let stopped = false;
  let lostLease = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    timer = setTimeout(() => {
      void renewProviderFeedbackLease(input)
        .then((active) => {
          if (!active) {
            lostLease = true;
            controller.abort(new Error("Provider feedback lease was lost."));
            return;
          }
          if (!stopped) schedule();
        })
        .catch(() => {
          lostLease = true;
          controller.abort(new Error("Provider feedback lease renewal failed."));
        });
    }, PROVIDER_FEEDBACK_LEASE_HEARTBEAT_MS);
  };
  schedule();

  return {
    signal: controller.signal,
    lostLease: () => lostLease,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

/** Converts adapter failures into safe retry policy without persisting response bodies. */
export function classifyProviderFeedbackFailure(error: unknown): ProviderFeedbackFailure {
  if (error instanceof ProviderFeedbackDeliveryError) {
    const retryable =
      error.retryable ??
      (error.statusCode === 429 ||
        (error.statusCode !== null && error.statusCode >= 500) ||
        error.statusCode === null);
    return {
      retryable,
      safeMessage: error.safeMessage,
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {})
    };
  }

  const statusCode = readStatusCode(error);
  if (statusCode === 429 || (statusCode !== null && statusCode >= 500) || isNetworkFailure(error)) {
    return {
      retryable: true,
      safeMessage: statusCode
        ? `Provider feedback request failed with HTTP ${statusCode}.`
        : "Provider feedback request failed due to a network error."
    };
  }

  if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
    return {
      retryable: false,
      safeMessage: `Provider feedback request was rejected with HTTP ${statusCode}.`
    };
  }

  return {
    retryable: true,
    safeMessage: "Provider feedback delivery failed."
  };
}

export async function processNextProviderFeedback(input?: {
  providerKinds?: readonly string[];
  now?: Date;
}) {
  const providerKinds = input?.providerKinds ?? listRegisteredProviderFeedbackKinds();
  if (providerKinds.length === 0) return { status: "idle" as const };

  const claimNow = input?.now ?? new Date();
  const feedback = await claimNextProviderFeedback({ providerKinds, now: claimNow });
  if (!feedback) return null;

  const adapter = getProviderFeedbackAdapter(feedback.providerKind);
  if (!adapter) {
    await markProviderFeedbackFailure({
      feedbackId: feedback.id,
      leaseToken: feedback.leaseToken ?? "",
      failure: {
        retryable: true,
        safeMessage: "No provider feedback adapter is registered for this provider kind."
      },
      now: input?.now,
      maxAttempts: Number.MAX_SAFE_INTEGER
    });
    return { status: "deferred" as const, feedbackId: feedback.id };
  }

  const heartbeat = startLeaseHeartbeat({
    feedbackId: feedback.id,
    leaseToken: feedback.leaseToken ?? ""
  });
  try {
    const adapterResult = await deliverProviderFeedback(adapter, feedback, heartbeat.signal);
    if (heartbeat.lostLease()) {
      return { status: "lost-lease" as const, feedbackId: feedback.id };
    }
    assertStableExternalIdentity(feedback.externalIds, adapterResult);
    const externalIds = adapterResult === undefined ? undefined : adapterResult;
    const delivered = await markProviderFeedbackDelivered({
      feedbackId: feedback.id,
      leaseToken: feedback.leaseToken ?? "",
      externalIds,
      now: input?.now
    });
    return delivered
      ? { status: "delivered" as const, feedbackId: delivered.id }
      : { status: "lost-lease" as const, feedbackId: feedback.id };
  } catch (error) {
    if (heartbeat.lostLease()) {
      return { status: "lost-lease" as const, feedbackId: feedback.id };
    }
    if (error instanceof ProviderFeedbackSkippedError) {
      const updated = await markProviderFeedbackSkipped({
        feedbackId: feedback.id,
        leaseToken: feedback.leaseToken ?? "",
        safeMessage: error.safeMessage,
        now: input?.now
      });
      return updated
        ? { status: "skipped" as const, feedbackId: updated.id }
        : { status: "lost-lease" as const, feedbackId: feedback.id };
    }
    const updated = await markProviderFeedbackFailure({
      feedbackId: feedback.id,
      leaseToken: feedback.leaseToken ?? "",
      failure: classifyProviderFeedbackFailure(error),
      now: input?.now,
      retryConfig: getProviderFeedbackRetryConfig()
    });
    return updated
      ? { status: updated.state, feedbackId: updated.id }
      : { status: "lost-lease" as const, feedbackId: feedback.id };
  } finally {
    heartbeat.stop();
  }
}
