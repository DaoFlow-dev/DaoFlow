import { and, eq, notInArray } from "drizzle-orm";
import { DeploymentLifecycleStatus } from "@daoflow/shared";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import {
  queueProviderFeedbackIntent,
  type ProviderFeedbackTransaction
} from "./provider-feedback-intents";

export interface DeploymentTransitionInput {
  deploymentId: string;
  status: string;
  conclusion?: string | null;
  error?: unknown;
  now?: Date;
}

export type ProviderFeedbackIntentWriter = typeof queueProviderFeedbackIntent;

export class DeploymentTransitionRejectedError extends Error {
  constructor(deploymentId: string, status: string) {
    super(
      `Deployment ${deploymentId} rejected transition to ${status} because it is already terminal.`
    );
    this.name = "DeploymentTransitionRejectedError";
  }
}

function transitionForProviderFeedback(input: DeploymentTransitionInput) {
  return input.conclusion === "cancelled" ? "cancelled" : input.status;
}

function deploymentErrorValue(error: unknown) {
  if (!error) return undefined;
  return error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: typeof error === "string" ? error : JSON.stringify(error) };
}

/**
 * Applies a deployment transition and writes its feedback intent using one
 * caller-owned transaction. A failed intent therefore rolls back the transition.
 */
export async function transitionDeploymentWithFeedbackInTransaction(
  tx: ProviderFeedbackTransaction,
  input: DeploymentTransitionInput,
  intentWriter: ProviderFeedbackIntentWriter = queueProviderFeedbackIntent
) {
  const now = input.now ?? new Date();
  const update: Record<string, unknown> = {
    status: input.status,
    updatedAt: now
  };

  if (input.conclusion) {
    update.conclusion = input.conclusion;
    update.concludedAt = now;
  }

  const error = deploymentErrorValue(input.error);
  if (error) update.error = error;

  const [deployment] = await tx
    .update(deployments)
    .set(update)
    .where(
      and(
        eq(deployments.id, input.deploymentId),
        notInArray(deployments.status, [
          DeploymentLifecycleStatus.Completed,
          DeploymentLifecycleStatus.Failed
        ])
      )
    )
    .returning();
  if (!deployment) return null;

  await intentWriter(tx, {
    deploymentId: deployment.id,
    transition: transitionForProviderFeedback(input),
    now
  });
  return deployment;
}

/** Owns the transaction for call sites that do not already have one. */
export function transitionDeploymentWithFeedback(input: DeploymentTransitionInput) {
  return db.transaction((tx) => transitionDeploymentWithFeedbackInTransaction(tx, input));
}

export async function requireDeploymentTransitionWithFeedback(input: DeploymentTransitionInput) {
  const deployment = await transitionDeploymentWithFeedback(input);
  if (!deployment) {
    throw new DeploymentTransitionRejectedError(input.deploymentId, input.status);
  }
  return deployment;
}
