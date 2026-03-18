import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { projects } from "../schema/projects";
import { services } from "../schema/services";
import { resolveTeamIdForUser } from "./teams";

export async function resolveTeamIdOrThrow(userId: string): Promise<string> {
  const teamId = await resolveTeamIdForUser(userId);
  if (!teamId) {
    throw new Error("No organization is available for this user.");
  }

  return teamId;
}

export async function resolveServiceForTeam(serviceRef: string, teamId: string) {
  const ref = serviceRef.trim();
  if (!ref) {
    throw new Error("Service reference is required.");
  }

  const [byId] = await db
    .select({ service: services })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(and(eq(services.id, ref), eq(projects.teamId, teamId)))
    .limit(1);
  if (byId) {
    return byId.service;
  }

  const matches = await db
    .select({ service: services })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(and(eq(services.name, ref), eq(projects.teamId, teamId)))
    .limit(2);
  if (matches.length > 1) {
    throw new Error(`Multiple services named "${ref}" exist. Use the service ID instead.`);
  }

  if (!matches[0]) {
    throw new Error(`Service "${ref}" not found.`);
  }

  return matches[0].service;
}

export async function resolveServiceForUser(serviceRef: string, userId: string) {
  const teamId = await resolveTeamIdOrThrow(userId);
  return resolveServiceForTeam(serviceRef, teamId);
}
