import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { providerFeedback } from "../schema/provider-feedback";
import type { ProviderFeedbackState } from "./provider-feedback-types";

export async function listProviderFeedbackForTeam(input: {
  teamId: string;
  states?: readonly ProviderFeedbackState[];
  limit: number;
}) {
  const stateFilter = input.states?.length
    ? inArray(providerFeedback.state, [...input.states])
    : undefined;
  return db
    .select({
      id: providerFeedback.id,
      sequence: providerFeedback.deliverySequence,
      deploymentId: providerFeedback.deploymentId,
      providerId: providerFeedback.providerId,
      providerKind: providerFeedback.providerKind,
      transition: providerFeedback.transition,
      idempotencyKey: providerFeedback.idempotencyKey,
      state: providerFeedback.state,
      attemptCount: providerFeedback.attemptCount,
      nextAttemptAt: providerFeedback.nextAttemptAt,
      leaseExpiresAt: providerFeedback.leaseExpiresAt,
      safeError: providerFeedback.safeError,
      context: providerFeedback.context,
      externalDeploymentId: providerFeedback.externalDeploymentId,
      externalStatusId: providerFeedback.externalStatusId,
      externalCommentId: providerFeedback.externalCommentId,
      deliveredAt: providerFeedback.deliveredAt,
      createdAt: providerFeedback.createdAt,
      updatedAt: providerFeedback.updatedAt
    })
    .from(providerFeedback)
    .where(and(eq(providerFeedback.teamId, input.teamId), stateFilter))
    .orderBy(desc(providerFeedback.createdAt))
    .limit(input.limit);
}
