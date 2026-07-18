import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import { projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { volumes } from "../schema/storage";
import { asRecord, readString } from "./json-helpers";

export async function resolveVolumeTeamId(volume: typeof volumes.$inferSelect) {
  const [server] = await db
    .select({ teamId: servers.teamId })
    .from(servers)
    .where(eq(servers.id, volume.serverId))
    .limit(1);
  const serverTeamId = server?.teamId ?? null;
  if (!serverTeamId) return null;

  const metadata = asRecord(volume.metadata);
  const projectId = readString(metadata, "projectId");
  const serviceId = readString(metadata, "serviceId");

  if (serviceId) {
    const [service] = await db
      .select({ projectId: services.projectId, teamId: projects.teamId })
      .from(services)
      .innerJoin(projects, eq(projects.id, services.projectId))
      .where(eq(services.id, serviceId))
      .limit(1);
    if (
      !service ||
      (projectId && projectId !== service.projectId) ||
      service.teamId !== serverTeamId
    ) {
      return null;
    }
    return serverTeamId;
  }

  if (!projectId) return serverTeamId;
  const [project] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project?.teamId === serverTeamId ? serverTeamId : null;
}

export async function resolveTeamScopedDestinationForVolume(
  volume: typeof volumes.$inferSelect,
  destinationId: string
) {
  const teamId = await resolveVolumeTeamId(volume);
  if (!teamId) return null;

  const [destination] = await db
    .select()
    .from(backupDestinations)
    .where(and(eq(backupDestinations.id, destinationId), eq(backupDestinations.teamId, teamId)))
    .limit(1);
  return destination ? { teamId, destination } : null;
}
