import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { servers } from "../schema/servers";

export interface SshHostIdentityActor {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export async function recordSshHostIdentityObservationAudit(input: {
  actor: SshHostIdentityActor;
  server: typeof servers.$inferSelect;
  observedFingerprints: string[];
  verification: "match" | "mismatch" | "unapproved";
}) {
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.actor.requestedByUserId,
    actorEmail: input.actor.requestedByEmail,
    actorRole: input.actor.requestedByRole,
    organizationId: input.server.teamId,
    targetResource: `server/${input.server.id}`,
    action: "server.ssh-host-identity.observe",
    inputSummary: `Observed ${input.observedFingerprints.length} SSH host key${input.observedFingerprints.length === 1 ? "" : "s"} for ${input.server.name}.`,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: "server",
      resourceId: input.server.id,
      resourceLabel: input.server.name,
      observedFingerprints: input.observedFingerprints,
      verification: input.verification
    }
  });
}
