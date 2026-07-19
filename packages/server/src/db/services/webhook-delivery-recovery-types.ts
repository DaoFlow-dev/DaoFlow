export type WebhookDeliveryRecoveryProvider = "github" | "gitlab";

export type WebhookDeliveryCompletionOutcome =
  "success" | "rejected" | "ignored" | "failed" | "partial";

export type WebhookDeliveryTargetOutcomeStatus = "completed" | "failed" | "ignored" | "rejected";

export type WebhookDeliverySafeMetadata = Record<
  string,
  string | number | boolean | null | readonly string[]
>;

export type WebhookDeliveryClaimResult =
  | {
      kind: "new" | "reclaimed";
      deliveryId: string;
      attemptId: string;
      leaseToken: string;
      leaseExpiresAt: Date;
    }
  | {
      kind: "live_duplicate";
      deliveryId: string;
      attemptId: string;
      leaseToken: null;
      leaseExpiresAt: Date;
    }
  | {
      kind: "terminal_duplicate";
      deliveryId: string;
      attemptId: string | null;
      leaseToken: null;
      terminalStatus: "succeeded" | "rejected" | "ignored" | "legacy";
    }
  | {
      kind: "body_digest_collision";
      deliveryId: string;
      attemptId: null;
      leaseToken: null;
    };

export type WebhookDeliveryLeaseResult =
  | {
      status: "active";
      deliveryId: string;
      attemptId: string;
      leaseExpiresAt: Date;
    }
  | { status: "stale_lease" };

export interface ClaimWebhookDeliveryRecoveryInput {
  providerType: WebhookDeliveryRecoveryProvider;
  eventType: string;
  deliveryKey: string;
  rawBody: string | Uint8Array;
  leaseToken: string;
  deliveryId?: string | null;
  repoFullName?: string | null;
  externalInstallationId?: string | null;
  commitSha?: string | null;
  metadata?: WebhookDeliverySafeMetadata;
  targetKeys?: readonly string[];
  leaseDurationMs?: number;
  now?: Date;
}

export interface CompleteWebhookDeliveryAttemptInput {
  deliveryId: string;
  attemptId: string;
  leaseToken: string;
  outcome: WebhookDeliveryCompletionOutcome;
  targetOutcomes?: readonly WebhookDeliveryTargetOutcomeInput[];
  detail?: unknown;
  errorSummary?: unknown;
  now?: Date;
}

export interface WebhookDeliveryTargetOutcomeInput {
  targetKey: string;
  status: WebhookDeliveryTargetOutcomeStatus;
  detail?: unknown;
  errorSummary?: unknown;
}

export interface ListWebhookDeliveryRetryEligibleTargetKeysInput {
  deliveryId: string;
  attemptId: string;
  leaseToken: string;
  now?: Date;
}

export interface WebhookDeliveryTargetSummary {
  totalTargetCount: number;
  terminalTargetCount: number;
  failedTargetCount: number;
  pendingTargetCount: number;
}

export type ListWebhookDeliveryRetryEligibleTargetKeysResult =
  | {
      status: "active";
      targetKeys: string[];
      targetSummary: WebhookDeliveryTargetSummary;
    }
  | {
      status: "stale_lease";
      targetKeys: [];
      targetSummary: WebhookDeliveryTargetSummary;
    };

export interface RecordWebhookDeliveryTargetOutcomeInput extends WebhookDeliveryTargetOutcomeInput {
  deliveryId: string;
  attemptId: string;
  leaseToken: string;
  now?: Date;
}

export interface BeginWebhookDeliveryTargetInput {
  deliveryId: string;
  attemptId: string;
  leaseToken: string;
  targetKey: string;
  now?: Date;
}

export interface RenewWebhookDeliveryLeaseInput {
  deliveryId: string;
  attemptId: string;
  leaseToken: string;
  leaseDurationMs?: number;
  now?: Date;
}

export type CompleteWebhookDeliveryAttemptResult =
  | {
      status: "completed";
      deliveryId: string;
      attemptId: string;
      targetOutcomes: Array<{
        targetKey: string;
        status: "stored" | "already_terminal";
      }>;
    }
  | { status: "stale_lease" };

export type RecordWebhookDeliveryTargetOutcomeResult =
  { status: "stored" | "already_terminal"; targetKey: string } | { status: "stale_lease" };

export type BeginWebhookDeliveryTargetResult =
  { status: "begun" | "already_terminal"; targetKey: string } | { status: "stale_lease" };

export type RenewWebhookDeliveryLeaseResult =
  | {
      status: "renewed";
      deliveryId: string;
      attemptId: string;
      leaseExpiresAt: Date;
    }
  | { status: "stale_lease" };

const TARGET_KEY_PATTERN = /^(project|service):[A-Za-z0-9_-]{1,32}$/;

export const DEFAULT_WEBHOOK_DELIVERY_LEASE_MS = 5 * 60 * 1_000;
const MAX_WEBHOOK_DELIVERY_LEASE_MS = 30 * 60 * 1_000;

function requireBoundedString(value: string, label: string, maximumLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error(`${label} must be between 1 and ${maximumLength} characters.`);
  }
  return normalized;
}

function normalizeOptionalBoundedString(
  value: string | null | undefined,
  label: string,
  maximumLength: number
) {
  if (value === null || value === undefined || value.trim().length === 0) {
    return null;
  }
  return requireBoundedString(value, label, maximumLength);
}

export function normalizeWebhookDeliveryTargetKeys(targetKeys: readonly string[] | undefined) {
  const normalized = new Set<string>();

  for (const targetKey of targetKeys ?? []) {
    const key = requireBoundedString(targetKey, "Webhook target key", 80);
    if (!TARGET_KEY_PATTERN.test(key)) {
      throw new Error("Webhook target keys must use project:<id> or service:<id>.");
    }
    normalized.add(key);
  }

  return [...normalized];
}

export function normalizeWebhookDeliveryLeaseDuration(leaseDurationMs: number | undefined) {
  const normalized = leaseDurationMs ?? DEFAULT_WEBHOOK_DELIVERY_LEASE_MS;
  if (
    !Number.isFinite(normalized) ||
    normalized <= 0 ||
    normalized > MAX_WEBHOOK_DELIVERY_LEASE_MS
  ) {
    throw new Error(
      `Webhook lease duration must be between 1 and ${MAX_WEBHOOK_DELIVERY_LEASE_MS}ms.`
    );
  }
  return normalized;
}

export function normalizeWebhookDeliveryClaimInput(input: ClaimWebhookDeliveryRecoveryInput) {
  if (input.providerType !== "github" && input.providerType !== "gitlab") {
    throw new Error("Webhook provider must be github or gitlab.");
  }

  return {
    providerType: input.providerType,
    eventType: requireBoundedString(input.eventType, "Webhook event type", 80),
    deliveryKey: requireBoundedString(input.deliveryKey, "Webhook delivery key", 200),
    leaseToken: requireBoundedString(input.leaseToken, "Webhook lease token", 128),
    deliveryId: normalizeOptionalBoundedString(input.deliveryId, "Provider delivery id", 200),
    repoFullName: normalizeOptionalBoundedString(input.repoFullName, "Repository name", 255),
    externalInstallationId: normalizeOptionalBoundedString(
      input.externalInstallationId,
      "External installation id",
      40
    ),
    commitSha: normalizeOptionalBoundedString(input.commitSha, "Commit SHA", 64),
    targetKeys: normalizeWebhookDeliveryTargetKeys(input.targetKeys),
    leaseDurationMs: normalizeWebhookDeliveryLeaseDuration(input.leaseDurationMs),
    now: input.now ?? new Date()
  };
}

export function normalizeWebhookDeliveryLeaseInput(input: {
  deliveryId: string;
  attemptId: string;
  leaseToken: string;
  now?: Date;
}) {
  return {
    deliveryId: requireBoundedString(input.deliveryId, "Webhook delivery id", 32),
    attemptId: requireBoundedString(input.attemptId, "Webhook attempt id", 32),
    leaseToken: requireBoundedString(input.leaseToken, "Webhook lease token", 128),
    now: input.now ?? new Date()
  };
}
