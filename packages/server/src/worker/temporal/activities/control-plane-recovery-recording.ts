import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../../db/connection";
import {
  controlPlaneRecoveryBundles,
  events,
  type ControlPlaneRecoveryManifest,
  type ControlPlaneRecoveryVerificationResult
} from "../../../db/schema";
import {
  assertControlPlaneRecoveryBundleId,
  safeControlPlaneRecoveryError
} from "./control-plane-recovery-safety";
import type { ControlPlaneRecoveryExecutionResult } from "./control-plane-recovery-types";

export async function markControlPlaneRecoveryRunning(bundleId: string): Promise<void> {
  const id = assertControlPlaneRecoveryBundleId(bundleId);
  const [started] = await db
    .update(controlPlaneRecoveryBundles)
    .set({
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      error: null,
      updatedAt: new Date()
    })
    .where(
      and(eq(controlPlaneRecoveryBundles.id, id), eq(controlPlaneRecoveryBundles.status, "queued"))
    )
    .returning({ id: controlPlaneRecoveryBundles.id });
  if (!started) {
    const status = await currentRecoveryStatus(id);
    if (status === "running") return;
    throw new Error(
      `Control-plane recovery bundle cannot start from ${status ?? "a missing"} state.`
    );
  }

  await emitRecoveryEvent(
    id,
    "control-plane-recovery.started",
    "Control-plane recovery started",
    "info"
  );
}

export async function markControlPlaneRecoveryVerified(
  result: ControlPlaneRecoveryExecutionResult
): Promise<void> {
  const id = assertControlPlaneRecoveryBundleId(result.bundleId);
  const [verified] = await db
    .update(controlPlaneRecoveryBundles)
    .set({
      status: "verified",
      appVersion: result.manifest.appVersion,
      schemaVersion: result.manifest.schemaVersion,
      keyFingerprint: result.keyFingerprint,
      keyRotatedAt: result.keyRotatedAt ? new Date(result.keyRotatedAt) : null,
      objectPrefix: result.objectPaths.prefix,
      bundleObjectPath: result.objectPaths.bundlePath,
      manifestObjectPath: result.objectPaths.manifestPath,
      latestManifestObjectPath: result.objectPaths.latestManifestPath,
      bundleChecksum: result.bundleChecksum,
      databaseChecksum: result.databaseChecksum,
      sizeBytes: String(result.sizeBytes),
      manifest: result.manifest,
      verificationResult: result.verificationResult,
      completedAt: new Date(),
      error: null,
      updatedAt: new Date()
    })
    .where(
      and(eq(controlPlaneRecoveryBundles.id, id), eq(controlPlaneRecoveryBundles.status, "running"))
    )
    .returning({ id: controlPlaneRecoveryBundles.id });
  if (!verified) {
    const status = await currentRecoveryStatus(id);
    if (status === "verified") return;
    throw new Error(
      `Control-plane recovery bundle cannot verify from ${status ?? "a missing"} state.`
    );
  }

  await emitRecoveryEvent(
    id,
    "control-plane-recovery.verified",
    "Control-plane recovery verified",
    "info"
  );
}

export async function markControlPlaneRecoveryFailed(
  bundleId: string,
  error: unknown
): Promise<void> {
  const id = assertControlPlaneRecoveryBundleId(bundleId);
  const [failed] = await db
    .update(controlPlaneRecoveryBundles)
    .set({
      status: "failed",
      completedAt: new Date(),
      error: safeControlPlaneRecoveryError(error),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(controlPlaneRecoveryBundles.id, id),
        inArray(controlPlaneRecoveryBundles.status, ["queued", "running"])
      )
    )
    .returning({ id: controlPlaneRecoveryBundles.id });
  if (!failed) {
    const status = await currentRecoveryStatus(id);
    if (status === "failed" || status === "verified") return;
    throw new Error(
      `Control-plane recovery bundle cannot fail from ${status ?? "a missing"} state.`
    );
  }

  await emitRecoveryEvent(
    id,
    "control-plane-recovery.failed",
    "Control-plane recovery failed",
    "error"
  );
}

async function currentRecoveryStatus(bundleId: string): Promise<string | null> {
  const [bundle] = await db
    .select({ status: controlPlaneRecoveryBundles.status })
    .from(controlPlaneRecoveryBundles)
    .where(eq(controlPlaneRecoveryBundles.id, bundleId))
    .limit(1);
  return bundle?.status ?? null;
}

async function emitRecoveryEvent(
  bundleId: string,
  kind: string,
  summary: string,
  severity: "info" | "error"
): Promise<void> {
  try {
    await db.insert(events).values({
      kind,
      resourceType: "control-plane-recovery",
      resourceId: bundleId,
      summary,
      severity,
      metadata: { version: 1 }
    });
  } catch {
    // Event evidence is supplemental; status recording remains authoritative.
  }
}

export type PersistedControlPlaneRecovery = {
  manifest: ControlPlaneRecoveryManifest;
  verificationResult: ControlPlaneRecoveryVerificationResult;
};
