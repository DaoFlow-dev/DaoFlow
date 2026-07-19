import { statSync } from "node:fs";
import { join } from "node:path";

import { inspectControlPlanePostgres } from "./control-plane-recovery-docker";
import {
  createSanitizedControlPlaneDump,
  dumpControlPlane,
  verifySanitizedControlPlaneDump
} from "./control-plane-recovery-database-restore";
import { RECOVERY_SANITIZED_FIELDS, sha256File } from "./control-plane-recovery-safety";
import type { PreparedControlPlaneRecoveryDump } from "./control-plane-recovery-types";

export async function prepareSanitizedControlPlaneRecoveryDump(input: {
  bundleId: string;
  workspace: string;
  cancellationSignal?: AbortSignal;
}): Promise<PreparedControlPlaneRecoveryDump> {
  const source = await inspectControlPlanePostgres(input.cancellationSignal);
  const sourceDumpPath = join(input.workspace, "source-control-plane.dump");
  const sanitizedDumpPath = join(input.workspace, "sanitized-control-plane.dump");
  await dumpControlPlane(source, sourceDumpPath, input.cancellationSignal);
  const dumpEvidence = await createSanitizedControlPlaneDump({
    bundleId: input.bundleId,
    verifierImage: source.verifierImage,
    sourceDumpPath,
    sanitizedDumpPath,
    cancellationSignal: input.cancellationSignal
  });
  const verification = await verifySanitizedControlPlaneDump({
    bundleId: input.bundleId,
    verifierImage: source.verifierImage,
    sanitizedDumpPath,
    expectedMigrations: dumpEvidence.migrations,
    expectedCounts: dumpEvidence.objectCounts,
    cancellationSignal: input.cancellationSignal
  });
  const databaseSha256 = await sha256File(sanitizedDumpPath);

  return {
    dumpPath: sanitizedDumpPath,
    databaseSha256,
    databaseSizeBytes: statSync(sanitizedDumpPath).size,
    sourcePostgresVersion: source.sourcePostgresVersion,
    verifierImage: source.verifierImage,
    migrations: dumpEvidence.migrations,
    objectCounts: verification.objectCounts,
    sanitization: { clearedFields: [...RECOVERY_SANITIZED_FIELDS] },
    verification: {
      version: 1,
      success: true,
      sourcePostgresVersion: source.sourcePostgresVersion,
      verifierImage: source.verifierImage,
      checks: verification.checks,
      objectCounts: verification.objectCounts
    }
  };
}
