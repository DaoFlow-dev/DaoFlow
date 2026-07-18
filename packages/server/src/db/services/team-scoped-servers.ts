import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { servers } from "../schema/servers";

export async function getServerForTeam(serverId: string, teamId: string) {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.teamId, teamId)))
    .limit(1);
  return server ?? null;
}

export async function resolveServerForTeam(serverRef: string, teamId: string) {
  const ref = serverRef.trim();
  if (!ref) return null;

  const [byId] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, ref), eq(servers.teamId, teamId)))
    .limit(1);
  if (byId) return byId;

  const [byName] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.name, ref), eq(servers.teamId, teamId)))
    .limit(1);
  return byName ?? null;
}
