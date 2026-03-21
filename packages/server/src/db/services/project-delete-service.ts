import { eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { environmentVariables, environments, projects } from "../schema/projects";
import { findScopedProject } from "./project-scoped-queries";
import type { DeleteProjectInput } from "./project-service-types";

export async function deleteProject(input: DeleteProjectInput) {
  const existing = input.teamId
    ? await findScopedProject(input.projectId, input.teamId)
    : ((await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1))[0] ??
      null);
  if (!existing) return { status: "not_found" as const };

  const envRows = await db
    .select()
    .from(environments)
    .where(eq(environments.projectId, input.projectId));

  for (const env of envRows) {
    await db.delete(environmentVariables).where(eq(environmentVariables.environmentId, env.id));
  }
  await db.delete(environments).where(eq(environments.projectId, input.projectId));
  await db.delete(projects).where(eq(projects.id, input.projectId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `project/${input.projectId}`,
    action: "project.delete",
    inputSummary: `Deleted project "${existing.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "project", resourceId: input.projectId }
  });

  return { status: "ok" as const };
}
