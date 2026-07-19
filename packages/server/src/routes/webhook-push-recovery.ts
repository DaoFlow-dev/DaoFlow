import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import { dispatchDeploymentExecution } from "../db/services/deployment-dispatch";
import {
  beginWebhookDeliveryTarget,
  claimWebhookDeliveryRecovery,
  completeWebhookDeliveryAttempt,
  listWebhookDeliveryRetryEligibleTargetKeys,
  recordWebhookDeliveryTargetOutcome,
  renewWebhookDeliveryLease,
  type WebhookDeliveryClaimResult,
  type WebhookDeliveryCompletionOutcome
} from "../db/services/webhook-delivery-recovery";
import type { WebhookDeliveryTargetSummary } from "../db/services/webhook-delivery-recovery-types";
import type { WebhookPushTargetOutcome } from "./webhooks-types";
import { asRecord } from "../db/services/json-helpers";
import { getDeploymentWorkflowStatus } from "../worker/temporal/client";
import { isTemporalEnabled } from "../worker/temporal/temporal-config";

type ActiveClaim = Extract<WebhookDeliveryClaimResult, { kind: "new" | "reclaimed" }>;

export class WebhookDeliveryLeaseLostError extends Error {
  constructor() {
    super("Webhook delivery processing lease is no longer active.");
    this.name = "WebhookDeliveryLeaseLostError";
  }
}

function requireActiveLease(result: { status: string }) {
  if (result.status === "stale_lease") {
    throw new WebhookDeliveryLeaseLostError();
  }
}

function mapTargetOutcome(outcome: WebhookPushTargetOutcome) {
  if (outcome.status === "queued") {
    return {
      targetKey: outcome.targetKey,
      status: "completed" as const,
      detail: `Queued deployment ${outcome.deploymentId}.`
    };
  }

  if (outcome.status === "failed") {
    return {
      targetKey: outcome.targetKey,
      status: "failed" as const,
      detail: `Deployment target failed with status ${outcome.failureStatus}.`,
      errorSummary: outcome.message ?? outcome.failureStatus
    };
  }

  return {
    targetKey: outcome.targetKey,
    status: "ignored" as const,
    detail: outcome.reason
  };
}

export async function claimRecoverableWebhookDelivery(input: {
  providerType: "github" | "gitlab";
  eventType: string;
  deliveryKey: string;
  providerDeliveryId?: string | null;
  rawBody: string;
  repoFullName: string;
  externalInstallationId?: string | null;
  commitSha: string;
  metadata: Record<string, string | number | boolean | null | readonly string[]>;
}) {
  return claimWebhookDeliveryRecovery({
    providerType: input.providerType,
    eventType: input.eventType,
    deliveryKey: input.deliveryKey,
    deliveryId: input.providerDeliveryId,
    rawBody: input.rawBody,
    repoFullName: input.repoFullName,
    externalInstallationId: input.externalInstallationId,
    commitSha: input.commitSha,
    metadata: input.metadata,
    leaseToken: randomUUID()
  });
}

export async function createWebhookPushRecoveryContext(claim: ActiveClaim) {
  const leaseInput = {
    deliveryId: claim.deliveryId,
    attemptId: claim.attemptId,
    leaseToken: claim.leaseToken
  };
  let targetSummary: WebhookDeliveryTargetSummary = {
    totalTargetCount: 0,
    terminalTargetCount: 0,
    failedTargetCount: 0,
    pendingTargetCount: 0
  };
  let retryAllDiscoveredTargets = claim.kind === "new";
  let retryEligibleTargetKeys = new Set<string>();

  async function refreshTargetSelection() {
    const retryState = await listWebhookDeliveryRetryEligibleTargetKeys(leaseInput);
    requireActiveLease(retryState);
    targetSummary = retryState.targetSummary;
    retryAllDiscoveredTargets = claim.kind === "new" || targetSummary.totalTargetCount === 0;
    retryEligibleTargetKeys = new Set(retryState.targetKeys);
  }

  await refreshTargetSelection();

  return {
    deliveryId: claim.deliveryId,
    get targetSummary() {
      return targetSummary;
    },
    get hasNoWork() {
      return !retryAllDiscoveredTargets && retryEligibleTargetKeys.size === 0;
    },
    async registerDiscoveredTargets(targetKeys: string[]) {
      const discovered = new Set(targetKeys);
      for (const missingTargetKey of retryEligibleTargetKeys) {
        if (discovered.has(missingTargetKey)) continue;
        const retired = await recordWebhookDeliveryTargetOutcome({
          ...leaseInput,
          targetKey: missingTargetKey,
          status: "ignored",
          detail: "Target is no longer configured for this webhook delivery."
        });
        requireActiveLease(retired);
      }
      for (const targetKey of targetKeys) {
        const begun = await beginWebhookDeliveryTarget({ ...leaseInput, targetKey });
        requireActiveLease(begun);
      }
      await refreshTargetSelection();
    },
    shouldProcessTarget(targetKey: string) {
      return retryAllDiscoveredTargets || retryEligibleTargetKeys.has(targetKey);
    },
    async findRecoveredDeployment(targetKey: string) {
      const [existing] = await db
        .select()
        .from(deployments)
        .where(
          and(
            eq(deployments.trigger, "webhook"),
            eq(deployments.webhookDeliveryId, claim.deliveryId),
            eq(deployments.webhookTargetKey, targetKey)
          )
        )
        .orderBy(desc(deployments.createdAt))
        .limit(1);

      if (!existing || existing.status === "failed" || existing.conclusion === "failed") {
        return null;
      }

      if (isTemporalEnabled()) {
        const snapshot = asRecord(existing.configSnapshot);
        const workflowId =
          typeof snapshot.temporalWorkflowId === "string" ? snapshot.temporalWorkflowId : null;
        if (!workflowId) {
          const runningWorkflow = await getDeploymentWorkflowStatus(existing.id);
          if (!runningWorkflow) {
            await dispatchDeploymentExecution(existing);
          }
        }
      }

      return existing;
    },
    async onTargetStarted(input: { targetKey: string }) {
      const renewed = await renewWebhookDeliveryLease(leaseInput);
      requireActiveLease(renewed);
      const begun = await beginWebhookDeliveryTarget({ ...leaseInput, targetKey: input.targetKey });
      requireActiveLease(begun);
    },
    async onTargetOutcome(outcome: WebhookPushTargetOutcome) {
      const recorded = await recordWebhookDeliveryTargetOutcome({
        ...leaseInput,
        ...mapTargetOutcome(outcome)
      });
      requireActiveLease(recorded);
    },
    async complete(input: {
      deploymentCount: number;
      failedTargetCount: number;
      ignoredTargetCount: number;
      detail: string;
    }) {
      const outcome = determineRecoveryOutcome({ ...input, targetSummary });
      const completed = await completeWebhookDeliveryAttempt({
        ...leaseInput,
        outcome,
        detail: input.detail,
        errorSummary:
          outcome === "failed" || outcome === "partial"
            ? "One or more webhook deployment targets remain incomplete."
            : undefined
      });
      requireActiveLease(completed);
      return outcome;
    },
    async fail() {
      const completed = await completeWebhookDeliveryAttempt({
        ...leaseInput,
        outcome: targetSummary.terminalTargetCount > 0 ? "partial" : "failed",
        detail: "Webhook processing failed before all targets completed.",
        errorSummary: "Webhook processing failed."
      });
      requireActiveLease(completed);
    }
  };
}

function determineRecoveryOutcome(input: {
  deploymentCount: number;
  failedTargetCount: number;
  ignoredTargetCount: number;
  targetSummary: WebhookDeliveryTargetSummary;
}): WebhookDeliveryCompletionOutcome {
  const hasCompletedTarget =
    input.deploymentCount > 0 || input.targetSummary.terminalTargetCount > 0;

  if (input.failedTargetCount > 0) {
    return hasCompletedTarget ? "partial" : "failed";
  }

  if (hasCompletedTarget) {
    return "success";
  }

  return input.ignoredTargetCount > 0 ? "ignored" : "success";
}
