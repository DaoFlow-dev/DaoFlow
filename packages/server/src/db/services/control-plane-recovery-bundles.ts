import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { controlPlaneRecoveryBundles } from "../schema/control-plane-recovery";
import { backupDestinations } from "../schema/destinations";
import { controlPlaneRecoveryObjectPaths } from "../../worker/temporal/activities/control-plane-recovery-safety";
import { buildControlPlaneRecoveryWorkflowId } from "../../worker/temporal/client";
import { newId } from "./json-helpers";
import {
  toControlPlaneRecoveryBundleView,
  toControlPlaneRecoveryMetadataView
} from "./control-plane-recovery-views";

const RECOVERY_TRIGGER_AUDIT_ACTION = "command.triggerControlPlaneRecoveryBundle";
const IDEMPOTENCY_KEY_PATTERN = /^sha256:[a-f0-9]{64}$/;

export class ControlPlaneRecoveryIdempotencyConflictError extends Error {}

function readIdempotencyKey(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).idempotencyKey;
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value) ? value : null;
}

async function resolveRequestIdempotencyKey(
  commandAuditAttemptId?: string
): Promise<string | null> {
  if (!commandAuditAttemptId) return null;

  const [attempt] = await db
    .select({ metadata: auditEntries.metadata })
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.action, RECOVERY_TRIGGER_AUDIT_ACTION),
        sql`${auditEntries.metadata}->>'attemptId' = ${commandAuditAttemptId}`,
        sql`${auditEntries.metadata}->>'phase' = 'intent'`
      )
    )
    .orderBy(desc(auditEntries.id))
    .limit(1);

  return readIdempotencyKey(attempt?.metadata);
}

async function findBundleByIdempotencyKey(input: {
  ownerTeamId: string;
  requestedByUserId: string;
  idempotencyKey: string;
}) {
  const [bundle] = await db
    .select()
    .from(controlPlaneRecoveryBundles)
    .where(
      and(
        eq(controlPlaneRecoveryBundles.ownerTeamId, input.ownerTeamId),
        eq(controlPlaneRecoveryBundles.requestedByUserId, input.requestedByUserId),
        eq(controlPlaneRecoveryBundles.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  return bundle ?? null;
}

function replayedBundle(
  input: { destinationId: string },
  bundle: typeof controlPlaneRecoveryBundles.$inferSelect
) {
  if (bundle.destinationId !== input.destinationId) {
    throw new ControlPlaneRecoveryIdempotencyConflictError(
      "The idempotency key is already associated with a different recovery request."
    );
  }

  return {
    bundle,
    workflowId: bundle.temporalWorkflowId ?? buildControlPlaneRecoveryWorkflowId(bundle.id),
    created: false as const
  };
}

async function loadBundleForOwner(bundleId: string, ownerTeamId: string) {
  const [bundle] = await db
    .select()
    .from(controlPlaneRecoveryBundles)
    .where(
      and(
        eq(controlPlaneRecoveryBundles.id, bundleId),
        eq(controlPlaneRecoveryBundles.ownerTeamId, ownerTeamId)
      )
    )
    .limit(1);
  if (!bundle) return null;

  const [destination] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, bundle.destinationId))
    .limit(1);
  return { bundle, destination: destination ?? null };
}

export async function listControlPlaneRecoveryBundles(input: {
  ownerTeamId: string;
  limit: number;
}) {
  const bundles = await db
    .select()
    .from(controlPlaneRecoveryBundles)
    .where(eq(controlPlaneRecoveryBundles.ownerTeamId, input.ownerTeamId))
    .orderBy(desc(controlPlaneRecoveryBundles.createdAt))
    .limit(input.limit);
  const destinationIds = [...new Set(bundles.map((bundle) => bundle.destinationId))];
  const destinations =
    destinationIds.length > 0
      ? await db
          .select()
          .from(backupDestinations)
          .where(inArray(backupDestinations.id, destinationIds))
      : [];
  const destinationsById = new Map(
    destinations.map((destination) => [destination.id, destination])
  );

  return {
    bundles: bundles.map((bundle) =>
      toControlPlaneRecoveryBundleView({
        bundle,
        destination: destinationsById.get(bundle.destinationId) ?? null
      })
    ),
    limit: input.limit
  };
}

export async function getControlPlaneRecoveryBundle(input: {
  bundleId: string;
  ownerTeamId: string;
}) {
  const loaded = await loadBundleForOwner(input.bundleId, input.ownerTeamId);
  return loaded ? toControlPlaneRecoveryBundleView(loaded) : null;
}

export async function getControlPlaneRecoveryBundleMetadata(input: {
  bundleId: string;
  ownerTeamId: string;
}) {
  const loaded = await loadBundleForOwner(input.bundleId, input.ownerTeamId);
  return loaded ? toControlPlaneRecoveryMetadataView(loaded) : null;
}

export async function queueControlPlaneRecoveryBundle(input: {
  destinationId: string;
  ownerTeamId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
  appVersion: string;
  schemaVersion: string;
  keyFingerprint: string;
  keyRotatedAt: string | null;
  commandAuditAttemptId?: string;
}) {
  const idempotencyKey = await resolveRequestIdempotencyKey(input.commandAuditAttemptId);
  if (idempotencyKey) {
    const existing = await findBundleByIdempotencyKey({
      ownerTeamId: input.ownerTeamId,
      requestedByUserId: input.requestedByUserId,
      idempotencyKey
    });
    if (existing) return replayedBundle(input, existing);
  }

  const bundleId = newId();
  const paths = controlPlaneRecoveryObjectPaths(bundleId);
  const workflowId = buildControlPlaneRecoveryWorkflowId(bundleId);
  const now = new Date();
  const [bundle] = await db
    .insert(controlPlaneRecoveryBundles)
    .values({
      id: bundleId,
      ownerTeamId: input.ownerTeamId,
      destinationId: input.destinationId,
      status: "queued",
      appVersion: input.appVersion,
      schemaVersion: input.schemaVersion,
      keyFingerprint: input.keyFingerprint,
      keyRotatedAt: input.keyRotatedAt ? new Date(input.keyRotatedAt) : null,
      objectPrefix: paths.prefix,
      bundleObjectPath: paths.bundlePath,
      manifestObjectPath: paths.manifestPath,
      latestManifestObjectPath: paths.latestManifestPath,
      idempotencyKey,
      temporalWorkflowId: workflowId,
      requestedByUserId: input.requestedByUserId,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoNothing({
      target: [
        controlPlaneRecoveryBundles.ownerTeamId,
        controlPlaneRecoveryBundles.requestedByUserId,
        controlPlaneRecoveryBundles.idempotencyKey
      ]
    })
    .returning();
  if (!bundle && idempotencyKey) {
    const existing = await findBundleByIdempotencyKey({
      ownerTeamId: input.ownerTeamId,
      requestedByUserId: input.requestedByUserId,
      idempotencyKey
    });
    if (existing) return replayedBundle(input, existing);
  }
  if (!bundle) {
    throw new Error("Recovery bundle could not be queued.");
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    organizationId: input.ownerTeamId,
    targetResource: `control-plane-recovery/${bundleId}`,
    action: "control-plane-recovery.trigger",
    inputSummary: "Queued control-plane recovery bundle for isolated verification.",
    permissionScope: "backup:run",
    outcome: "accepted",
    metadata: {
      resourceType: "control-plane-recovery",
      resourceId: bundleId,
      destinationId: input.destinationId,
      workflowId
    }
  });

  return { bundle, workflowId, created: true as const };
}

export async function recordControlPlaneRecoveryBundleDispatch(input: {
  bundleId: string;
  workflowId: string;
  runId?: string;
}): Promise<boolean> {
  const [updated] = await db
    .update(controlPlaneRecoveryBundles)
    .set({
      temporalWorkflowId: input.workflowId,
      temporalRunId: input.runId ?? null,
      dispatchedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(controlPlaneRecoveryBundles.id, input.bundleId),
        inArray(controlPlaneRecoveryBundles.status, ["queued", "running"]),
        isNull(controlPlaneRecoveryBundles.dispatchedAt)
      )
    )
    .returning({ id: controlPlaneRecoveryBundles.id });
  return Boolean(updated);
}
