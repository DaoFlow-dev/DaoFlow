import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { projects } from "../schema/projects";

export class ScopedDeploymentNotFoundError extends Error {
  constructor(deploymentRef: string) {
    super(`Deployment "${deploymentRef}" not found.`);
    this.name = "ScopedDeploymentNotFoundError";
  }
}

export async function resolveDeploymentForTeam(deploymentRef: string, teamId: string) {
  const ref = deploymentRef.trim();
  if (!ref) {
    throw new Error("Deployment reference is required.");
  }

  const [match] = await db
    .select({ deployment: deployments })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .where(and(eq(projects.teamId, teamId), eq(deployments.id, ref)))
    .limit(1);

  if (!match) {
    throw new ScopedDeploymentNotFoundError(ref);
  }

  return match.deployment;
}
