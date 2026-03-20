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
type DeliveryStatus = "processing" | "queued" | "deduped" | "ignored" | "mixed" | "failed";
type LifecycleOutcome = "queued" | "deduped" | "ignored" | "failed";

function trimMetadata(value: Record<string, unknown> | undefined) {
  return value ? value : {};
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
