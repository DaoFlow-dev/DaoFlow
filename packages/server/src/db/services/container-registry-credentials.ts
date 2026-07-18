import { and, desc, eq, inArray } from "drizzle-orm";
import {
  collectContainerRegistryHostsFromImageReferences,
  type ContainerRegistryCredential
} from "../../container-registries-shared";
import { db } from "../connection";
import { decrypt } from "../crypto";
import { projects } from "../schema/projects";
import { containerRegistries } from "../schema/registries";

function toCredential(row: typeof containerRegistries.$inferSelect): ContainerRegistryCredential {
  return {
    id: row.id,
    registryHost: row.registryHost,
    username: row.username,
    password: decrypt(row.passwordEncrypted)
  };
}

async function getProjectTeamId(projectId: string) {
  const [project] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project?.teamId ?? null;
}

export async function listContainerRegistryCredentialsForProject(projectId: string) {
  const teamId = await getProjectTeamId(projectId);
  if (!teamId) return [];

  const rows = await db
    .select()
    .from(containerRegistries)
    .where(eq(containerRegistries.teamId, teamId))
    .orderBy(desc(containerRegistries.createdAt));
  return rows.map(toCredential);
}

export async function listContainerRegistryCredentialsForProjectImageReferences(
  projectId: string,
  imageReferences: Iterable<string | null | undefined>
) {
  const teamId = await getProjectTeamId(projectId);
  const registryHosts = collectContainerRegistryHostsFromImageReferences(imageReferences);
  if (!teamId || registryHosts.length === 0) return [];

  const rows = await db
    .select()
    .from(containerRegistries)
    .where(
      and(
        eq(containerRegistries.teamId, teamId),
        inArray(containerRegistries.registryHost, registryHosts)
      )
    )
    .orderBy(desc(containerRegistries.createdAt));
  return rows.map(toCredential);
}
