import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  previewModeAllowsRequest,
  readComposePreviewConfigFromConfig,
  readComposePreviewMetadata,
  type ComposePreviewAction,
  type ComposePreviewRequest
} from "../../compose-preview";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { deployments } from "../schema/deployments";
import { services } from "../schema/services";
import { webhookDeliveries } from "../schema/webhook-deliveries";
import { asRecord, newId } from "./json-helpers";

type ProviderType = "github" | "gitlab";
type DeliveryStatus =
  | "processing"
  | "queued"
  | "ignored"
  | "rejected"
  | "failed"
  | "partial"
  | "deduped"
  | "mixed";
type LifecycleOutcome = "queued" | "deduped" | "ignored" | "failed";

export type WebhookDeliveryProviderType = ProviderType;
export type WebhookDeliveryStatus = DeliveryStatus;

function trimMetadata(value: Record<string, unknown> | undefined) {
  return value ? value : {};
}

export function buildWebhookDeliveryKey(input: {
  providerType: WebhookDeliveryProviderType;
  eventType: string;
  rawBody: string;
  deliveryId?: string | null;
}): { deliveryId: string | null; deliveryKey: string } {
  const deliveryId = input.deliveryId?.trim() || null;
  if (deliveryId) {
    return {
      deliveryId,
      deliveryKey: deliveryId
    };
  }

  const fingerprint = createHash("sha256")
    .update(`${input.providerType}:${input.eventType}:${input.rawBody}`)
    .digest("hex");

  return {
    deliveryId: null,
    deliveryKey: fingerprint
  };
}

export async function claimWebhookDelivery(input: {
  providerType: WebhookDeliveryProviderType;
  eventType: string;
  rawBody: string;
  deliveryId?: string | null;
  repoFullName?: string | null;
  externalInstallationId?: string | null;
  commitSha?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { deliveryId, deliveryKey } = buildWebhookDeliveryKey(input);
  const [created] = await db
    .insert(webhookDeliveries)
    .values({
      id: newId(),
      providerType: input.providerType,
      eventType: input.eventType,
      deliveryKey,
      deliveryId,
      repoFullName: input.repoFullName ?? null,
      externalInstallationId: input.externalInstallationId ?? null,
      commitSha: input.commitSha ?? null,
      status: "processing",
      metadata: trimMetadata(input.metadata),
      lastSeenAt: new Date()
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return {
      status: "claimed" as const,
      delivery: created,
      deliveryKey
    };
  }

  const [existing] = await db
    .update(webhookDeliveries)
    .set({
      lastSeenAt: new Date()
    })
    .where(
      and(
        eq(webhookDeliveries.providerType, input.providerType),
        eq(webhookDeliveries.deliveryKey, deliveryKey)
      )
    )
    .returning();

  return {
    status: "duplicate" as const,
    delivery: existing ?? null,
    deliveryKey
  };
}

export async function beginWebhookDelivery(input: {
  providerType: ProviderType;
  deliveryKey: string;
  eventType: string;
  repoFullName: string;
  previewKey?: string;
  previewAction?: ComposePreviewAction;
  commitSha?: string;
  metadata?: Record<string, unknown>;
}) {
  const [created] = await db
    .insert(webhookDeliveries)
    .values({
      id: newId(),
      providerType: input.providerType,
      deliveryKey: input.deliveryKey,
      eventType: input.eventType,
      repoFullName: input.repoFullName,
      previewKey: input.previewKey ?? null,
      previewAction: input.previewAction ?? null,
      commitSha: input.commitSha ?? null,
      status: "processing",
      metadata: trimMetadata(input.metadata),
      lastSeenAt: new Date()
    })
    .onConflictDoNothing({
      target: [webhookDeliveries.providerType, webhookDeliveries.deliveryKey]
    })
    .returning();

  if (created) {
    return { status: "started" as const, delivery: created };
  }

  const [existing] = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.providerType, input.providerType),
        eq(webhookDeliveries.deliveryKey, input.deliveryKey)
      )
    )
    .limit(1);

  return { status: "duplicate" as const, delivery: existing ?? null };
}

export async function completeWebhookDelivery(input: {
  providerType: ProviderType;
  deliveryKey: string;
  outcome: DeliveryStatus;
  detail?: string;
  metadata?: Record<string, unknown>;
}) {
  await db
    .update(webhookDeliveries)
    .set({
      status: input.outcome,
      detail: input.detail ?? null,
      metadata: trimMetadata(input.metadata),
      lastSeenAt: new Date(),
      processedAt: new Date()
    })
    .where(
      and(
        eq(webhookDeliveries.providerType, input.providerType),
        eq(webhookDeliveries.deliveryKey, input.deliveryKey)
      )
    );
}

export async function finalizeWebhookDelivery(input: {
  providerType: WebhookDeliveryProviderType;
  deliveryKey: string;
  status: WebhookDeliveryStatus;
  metadata: Record<string, unknown>;
}) {
  const [updated] = await db
    .update(webhookDeliveries)
    .set({
      status: input.status,
      metadata: trimMetadata(input.metadata),
      lastSeenAt: new Date(),
      processedAt: new Date()
    })
    .where(
      and(
        eq(webhookDeliveries.providerType, input.providerType),
        eq(webhookDeliveries.deliveryKey, input.deliveryKey)
      )
    )
    .returning();

  return updated ?? null;
}

export async function listEligiblePreviewWebhookServices(input: {
  projectId: string;
  previewRequest: ComposePreviewRequest;
}) {
  const rows = await db
    .select()
    .from(services)
    .where(and(eq(services.projectId, input.projectId), eq(services.sourceType, "compose")));

  return rows.filter((service) => {
    const previewConfig = readComposePreviewConfigFromConfig(service.config);
    return (
      previewConfig !== null &&
      previewConfig.enabled &&
      previewModeAllowsRequest(previewConfig.mode, input.previewRequest)
    );
  });
}

export async function findLatestPreviewDeploymentForService(input: {
  projectId: string;
  environmentId: string;
  serviceName: string;
  previewKey: string;
}) {
  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, input.projectId),
        eq(deployments.environmentId, input.environmentId),
        eq(deployments.serviceName, input.serviceName),
        eq(deployments.sourceType, "compose")
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(50);

  for (const row of rows) {
    const preview = readComposePreviewMetadata(asRecord(row.configSnapshot).preview);
    if (preview?.key === input.previewKey) {
      return row;
    }
  }

  return null;
}

export async function recordPreviewWebhookLifecycleEvent(input: {
  providerType: ProviderType;
  repoFullName: string;
  projectId: string;
  serviceId?: string;
  actorEmail: string;
  previewKey: string;
  previewAction: ComposePreviewAction;
  eventAction: string;
  outcome: LifecycleOutcome;
  summary: string;
  detail: string;
  commitSha?: string;
  deploymentId?: string;
  metadata?: Record<string, unknown>;
}) {
  const resourceType = input.serviceId ? "service" : "project";
  const resourceId = input.serviceId ?? input.projectId;
  const targetResource = input.serviceId
    ? `service/${input.serviceId}`
    : `project/${input.projectId}`;
  const lifecycleAction =
    input.outcome === "queued"
      ? `webhook.preview.${input.previewAction}`
      : `webhook.preview.${input.outcome}`;

  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: `${input.providerType}-webhook`,
    actorEmail: input.actorEmail,
    actorRole: "agent",
    targetResource,
    action: lifecycleAction,
    inputSummary: input.summary,
    permissionScope: "deploy:start",
    outcome: input.outcome === "failed" ? "failed" : "success",
    metadata: {
      providerType: input.providerType,
      repoFullName: input.repoFullName,
      previewKey: input.previewKey,
      previewAction: input.previewAction,
      eventAction: input.eventAction,
      commitSha: input.commitSha ?? null,
      deploymentId: input.deploymentId ?? null,
      ...(input.metadata ?? {})
    }
  });

  await db.insert(events).values({
    kind: `${lifecycleAction}.recorded`,
    resourceType,
    resourceId,
    summary: input.summary,
    detail: input.detail,
    severity: input.outcome === "failed" ? "warning" : "info",
    metadata: {
      providerType: input.providerType,
      repoFullName: input.repoFullName,
      previewKey: input.previewKey,
      previewAction: input.previewAction,
      eventAction: input.eventAction,
      commitSha: input.commitSha ?? null,
      deploymentId: input.deploymentId ?? null,
      ...(input.metadata ?? {})
    },
    createdAt: new Date()
  });
}
