import { Context } from "@temporalio/activity";
import { and, eq } from "drizzle-orm";
import { join } from "node:path";
import { db } from "../../../db/connection";
import { backupDestinations } from "../../../db/schema/destinations";
import { externalBackupArtifacts } from "../../../db/schema/external-backup-artifacts";
import { createExternalS3Adapter } from "../../external-backup-s3";
import { toExternalArtifactS3Destination } from "./external-backup-artifact-runtime";

export type ExternalArtifactContext = {
  artifact: typeof externalBackupArtifacts.$inferSelect;
  destination: typeof backupDestinations.$inferSelect;
};

export async function loadExternalArtifactContext(
  artifactId: string
): Promise<ExternalArtifactContext | null> {
  const [row] = await db
    .select({ artifact: externalBackupArtifacts, destination: backupDestinations })
    .from(externalBackupArtifacts)
    .innerJoin(backupDestinations, eq(backupDestinations.id, externalBackupArtifacts.destinationId))
    .where(
      and(
        eq(externalBackupArtifacts.id, artifactId),
        eq(externalBackupArtifacts.teamId, backupDestinations.teamId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function downloadExternalArtifact(context: ExternalArtifactContext, workDir: string) {
  const adapter = createExternalS3Adapter(toExternalArtifactS3Destination(context.destination));
  const path = join(workDir, "artifact.dump");
  const result = await adapter.downloadPinnedObject(
    {
      key: context.artifact.objectKey,
      versionId: context.artifact.objectVersion,
      etag: context.artifact.objectEtag,
      size: Number(context.artifact.sizeBytes),
      contentType: context.artifact.contentType,
      lastModified: context.artifact.lastModified
    },
    path,
    temporalExternalArtifactHooks()
  );
  return { path, ...result };
}

export function temporalExternalArtifactHooks() {
  const context = Context.current();
  return {
    heartbeat: () => context.heartbeat(),
    cancellationSignal: context.cancellationSignal
  };
}
