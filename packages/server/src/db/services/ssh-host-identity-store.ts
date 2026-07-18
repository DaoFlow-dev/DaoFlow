import { and, asc, eq } from "drizzle-orm";
import { db } from "../connection";
import { servers } from "../schema/servers";
import { sshHostIdentities } from "../schema/ssh-host-identities";

export function summarizeSshHostIdentity(row: typeof sshHostIdentities.$inferSelect) {
  return {
    id: row.id,
    algorithm: row.algorithm,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    status: row.status,
    observedAt: row.observedAt.toISOString(),
    lastObservedAt: row.lastObservedAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null
  };
}

export async function getServerForSshHostIdentityTeam(serverId: string, teamId: string) {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.teamId, teamId)))
    .limit(1);
  return server ?? null;
}

export async function getSshHostIdentityRows(serverId: string, teamId: string) {
  return db
    .select()
    .from(sshHostIdentities)
    .where(and(eq(sshHostIdentities.serverId, serverId), eq(sshHostIdentities.teamId, teamId)))
    .orderBy(asc(sshHostIdentities.createdAt));
}
