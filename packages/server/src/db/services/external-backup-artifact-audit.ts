import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";

export async function writeExternalBackupArtifactAudit(input: {
  actor?: { userId: string; email: string; role: AppRole };
  teamId: string;
  destinationId: string;
  artifactId?: string;
  objectKey?: string;
  action: string;
  permissionScope: string;
  outcome: "success" | "failure" | "denied";
  detail: string;
}) {
  await db.insert(auditEntries).values({
    actorType: input.actor ? "user" : "system",
    actorId: input.actor?.userId ?? "external-artifact-worker",
    actorEmail: input.actor?.email ?? "system@daoflow.local",
    actorRole: input.actor?.role ?? "system",
    organizationId: input.teamId,
    targetResource: input.artifactId
      ? `external-backup-artifact/${input.artifactId}`
      : `backup-destination/${input.destinationId}`,
    action: input.action,
    inputSummary: input.detail,
    permissionScope: input.permissionScope,
    outcome: input.outcome,
    metadata: {
      teamId: input.teamId,
      resourceType: "external-backup-artifact",
      ...(input.artifactId ? { resourceId: input.artifactId } : {}),
      destinationId: input.destinationId,
      ...(input.objectKey ? { objectKey: input.objectKey } : {}),
      detail: input.detail
    }
  });
}
