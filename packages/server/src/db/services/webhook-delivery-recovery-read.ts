import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../connection";
import { projects } from "../schema/projects";
import { services } from "../schema/services";
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookDeliveryTargets
} from "../schema/webhook-deliveries";

async function listTeamTargetRows(input: {
  teamId: string;
  deliveryIds?: string[];
  limit?: number;
}) {
  const projectTargetKey = sql<string>`'project:' || ${projects.id}`;
  const serviceTargetKey = sql<string>`'service:' || ${services.id}`;
  const projectWhere = input.deliveryIds?.length
    ? inArray(webhookDeliveryTargets.deliveryId, input.deliveryIds)
    : undefined;
  const serviceWhere = input.deliveryIds?.length
    ? inArray(webhookDeliveryTargets.deliveryId, input.deliveryIds)
    : undefined;

  const projectQuery = db
    .select({ target: webhookDeliveryTargets })
    .from(webhookDeliveryTargets)
    .innerJoin(projects, eq(webhookDeliveryTargets.targetKey, projectTargetKey))
    .where(
      projectWhere
        ? sql`${projects.teamId} = ${input.teamId} and ${projectWhere}`
        : eq(projects.teamId, input.teamId)
    )
    .orderBy(desc(webhookDeliveryTargets.updatedAt));

  const serviceQuery = db
    .select({ target: webhookDeliveryTargets })
    .from(webhookDeliveryTargets)
    .innerJoin(services, eq(webhookDeliveryTargets.targetKey, serviceTargetKey))
    .innerJoin(projects, eq(services.projectId, projects.id))
    .where(
      serviceWhere
        ? sql`${projects.teamId} = ${input.teamId} and ${serviceWhere}`
        : eq(projects.teamId, input.teamId)
    )
    .orderBy(desc(webhookDeliveryTargets.updatedAt));

  const [projectTargets, serviceTargets] = await Promise.all([
    input.limit ? projectQuery.limit(input.limit) : projectQuery,
    input.limit ? serviceQuery.limit(input.limit) : serviceQuery
  ]);

  return [...projectTargets, ...serviceTargets].map((row) => row.target);
}

export async function listWebhookDeliveryRecoveryForTeam(input: {
  teamId: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const recentTargets = await listTeamTargetRows({
    teamId: input.teamId,
    limit: limit * 4
  });
  const candidateDeliveryIds = [...new Set(recentTargets.map((target) => target.deliveryId))];
  if (candidateDeliveryIds.length === 0) {
    return [];
  }

  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.id, candidateDeliveryIds))
    .orderBy(desc(webhookDeliveries.lastSeenAt))
    .limit(limit);
  const deliveryIds = deliveries.map((delivery) => delivery.id);
  if (deliveryIds.length === 0) {
    return [];
  }

  const [attempts, targets] = await Promise.all([
    db
      .select()
      .from(webhookDeliveryAttempts)
      .where(inArray(webhookDeliveryAttempts.deliveryId, deliveryIds))
      .orderBy(desc(webhookDeliveryAttempts.attemptNumber)),
    listTeamTargetRows({ teamId: input.teamId, deliveryIds })
  ]);

  return deliveries.map((delivery) => ({
    id: delivery.id,
    providerType: delivery.providerType,
    eventType: delivery.eventType,
    providerDeliveryId: delivery.deliveryId,
    repoFullName: delivery.repoFullName,
    commitSha: delivery.commitSha,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    lastErrorSummary: delivery.lastErrorSummary,
    createdAt: delivery.createdAt,
    lastSeenAt: delivery.lastSeenAt,
    processedAt: delivery.processedAt,
    attempts: attempts
      .filter((attempt) => attempt.deliveryId === delivery.id)
      .map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        errorSummary: attempt.errorSummary,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt
      })),
    targets: targets
      .filter((target) => target.deliveryId === delivery.id)
      .map((target) => ({
        targetKey: target.targetKey,
        status: target.status,
        detail: target.detail,
        errorSummary: target.errorSummary,
        updatedAt: target.updatedAt,
        completedAt: target.completedAt
      }))
  }));
}
