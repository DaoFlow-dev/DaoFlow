import {
  DeploymentConclusion,
  DeploymentHealthStatus,
  DeploymentLifecycleStatus
} from "@daoflow/shared";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../connection";
import { deployments, deploymentSteps } from "../schema/deployments";
import { projects } from "../schema/projects";
import { buildDeploymentIndex, buildDeploymentView } from "./deployment-record-views";

export async function getDeploymentRecord(deploymentId: string, teamId?: string) {
  const filters = [eq(deployments.id, deploymentId)];
  if (teamId) filters.push(eq(projects.teamId, teamId));
  const [row] = await db
    .select({ deployment: deployments })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .where(and(...filters))
    .limit(1);
  if (!row) return null;
  const deployment = row.deployment;

  const steps = await db
    .select()
    .from(deploymentSteps)
    .where(eq(deploymentSteps.deploymentId, deploymentId))
    .orderBy(deploymentSteps.sortOrder);

  const index = await buildDeploymentIndex([deployment]);

  return buildDeploymentView(
    deployment,
    index.projectById.get(deployment.projectId),
    index.environmentById.get(deployment.environmentId),
    index.serverById.get(deployment.targetServerId),
    index.serviceByKey.get(
      `${deployment.projectId}:${deployment.environmentId}:${deployment.serviceName}`
    ),
    steps
  );
}

function deploymentStatusCondition(status?: string): SQL | undefined {
  if (!status) return undefined;
  switch (status) {
    case DeploymentHealthStatus.Healthy:
      return and(
        eq(deployments.status, DeploymentLifecycleStatus.Completed),
        eq(deployments.conclusion, DeploymentConclusion.Succeeded)
      );
    case DeploymentHealthStatus.Failed:
      return sql`${deployments.status} = ${DeploymentLifecycleStatus.Failed}
        or ${deployments.conclusion} = ${DeploymentConclusion.Failed}
        or ${deployments.conclusion} = ${DeploymentConclusion.Cancelled}`;
    case DeploymentHealthStatus.Running:
      return sql`${deployments.status} in (${DeploymentLifecycleStatus.Prepare}, ${DeploymentLifecycleStatus.Deploy}, ${DeploymentLifecycleStatus.Finalize}, ${DeploymentLifecycleStatus.Running})`;
    default:
      return sql`${deployments.status} not in (${DeploymentLifecycleStatus.Failed}, ${DeploymentLifecycleStatus.Completed}, ${DeploymentLifecycleStatus.Prepare}, ${DeploymentLifecycleStatus.Deploy}, ${DeploymentLifecycleStatus.Finalize}, ${DeploymentLifecycleStatus.Running})
        and coalesce(${deployments.conclusion}, '') not in (${DeploymentConclusion.Failed}, ${DeploymentConclusion.Cancelled})`;
  }
}

export async function listDeploymentRecords(
  status: string | undefined,
  limit: number,
  teamId: string
) {
  const filters: SQL[] = [];
  const statusCondition = deploymentStatusCondition(status);
  if (statusCondition) filters.push(statusCondition);
  filters.push(eq(projects.teamId, teamId));
  const rows = (
    await db
      .select({ deployment: deployments })
      .from(deployments)
      .innerJoin(projects, eq(projects.id, deployments.projectId))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(deployments.createdAt))
      .limit(limit)
  ).map((row) => row.deployment);
  if (rows.length === 0) return [];
  const index = await buildDeploymentIndex(rows);

  const steps = await db
    .select()
    .from(deploymentSteps)
    .where(
      inArray(
        deploymentSteps.deploymentId,
        rows.map((row) => row.id)
      )
    )
    .orderBy(deploymentSteps.sortOrder);

  const stepsByDeploymentId = new Map<string, (typeof deploymentSteps.$inferSelect)[]>();
  for (const step of steps) {
    const collection = stepsByDeploymentId.get(step.deploymentId) ?? [];
    collection.push(step);
    stepsByDeploymentId.set(step.deploymentId, collection);
  }

  const mapped = rows.map((deployment) =>
    buildDeploymentView(
      deployment,
      index.projectById.get(deployment.projectId),
      index.environmentById.get(deployment.environmentId),
      index.serverById.get(deployment.targetServerId),
      index.serviceByKey.get(
        `${deployment.projectId}:${deployment.environmentId}:${deployment.serviceName}`
      ),
      stepsByDeploymentId.get(deployment.id) ?? []
    )
  );

  return status ? mapped.filter((deployment) => deployment.status === status) : mapped;
}
