import type { AppRole } from "@daoflow/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../connection";
import { controlPlaneRecoveryBundles } from "../schema/control-plane-recovery";
import { safeControlPlaneRecoveryError } from "../../worker/temporal/activities/control-plane-recovery-safety";
import { startControlPlaneRecoveryWorkflow } from "../../worker/temporal/client";
import {
  ControlPlaneRecoveryIdempotencyConflictError,
  queueControlPlaneRecoveryBundle,
  recordControlPlaneRecoveryBundleDispatch
} from "./control-plane-recovery-bundles";
import {
  buildControlPlaneRecoveryPlan,
  getControlPlaneRecoveryDestinationForOwner
} from "./control-plane-recovery-plan";
import { toControlPlaneRecoveryBundleView } from "./control-plane-recovery-views";

export {
  getControlPlaneRecoveryBundle,
  getControlPlaneRecoveryBundleMetadata,
  listControlPlaneRecoveryBundles
} from "./control-plane-recovery-bundles";
export { buildControlPlaneRecoveryPlan } from "./control-plane-recovery-plan";

export class ControlPlaneRecoveryPreconditionError extends Error {}
export { ControlPlaneRecoveryIdempotencyConflictError };

export async function reconcileQueuedControlPlaneRecoveryBundles(input?: { limit?: number }) {
  const limit = Math.max(1, Math.min(input?.limit ?? 25, 100));
  const candidates = await db
    .select({ id: controlPlaneRecoveryBundles.id })
    .from(controlPlaneRecoveryBundles)
    .where(
      and(
        eq(controlPlaneRecoveryBundles.status, "queued"),
        isNull(controlPlaneRecoveryBundles.dispatchedAt)
      )
    )
    .orderBy(asc(controlPlaneRecoveryBundles.createdAt))
    .limit(limit);
  const failures: Array<{ bundleId: string; error: string }> = [];
  let dispatchedCount = 0;

  for (const candidate of candidates) {
    try {
      const workflow = await startControlPlaneRecoveryWorkflow({ bundleId: candidate.id });
      if (
        await recordControlPlaneRecoveryBundleDispatch({
          bundleId: candidate.id,
          workflowId: workflow.workflowId,
          runId: workflow.runId
        })
      ) {
        dispatchedCount += 1;
      }
    } catch (error) {
      failures.push({ bundleId: candidate.id, error: safeControlPlaneRecoveryError(error) });
    }
  }

  return { eligibleCount: candidates.length, dispatchedCount, failures };
}

export async function triggerControlPlaneRecoveryBundle(input: {
  destinationId: string;
  ownerTeamId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
  commandAuditAttemptId?: string;
}) {
  const plan = await buildControlPlaneRecoveryPlan({
    destinationId: input.destinationId,
    ownerTeamId: input.ownerTeamId
  });
  if (!plan.destination) return null;
  if (!plan.isReady || !plan.keyFingerprint) {
    throw new ControlPlaneRecoveryPreconditionError("Control-plane recovery is not ready.");
  }
  const destination = await getControlPlaneRecoveryDestinationForOwner(
    input.destinationId,
    input.ownerTeamId
  );
  if (!destination) return null;

  const queued = await queueControlPlaneRecoveryBundle({
    ...input,
    appVersion: plan.appVersion,
    schemaVersion: plan.schemaVersion,
    keyFingerprint: plan.keyFingerprint,
    keyRotatedAt: plan.keyRotatedAt
  });

  if (queued.bundle.status === "queued" && !queued.bundle.dispatchedAt) {
    try {
      const workflow = await startControlPlaneRecoveryWorkflow({ bundleId: queued.bundle.id });
      await recordControlPlaneRecoveryBundleDispatch({
        bundleId: queued.bundle.id,
        workflowId: workflow.workflowId,
        runId: workflow.runId
      });
    } catch (error) {
      // The durable queued row is deliberately retained. A retry with the same
      // idempotency key can attach to the deterministic Temporal workflow.
      throw new Error(safeControlPlaneRecoveryError(error));
    }
  }

  return toControlPlaneRecoveryBundleView({ bundle: queued.bundle, destination });
}
