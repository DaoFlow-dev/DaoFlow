import {
  DeploymentConclusion,
  DeploymentHealthStatus,
  DeploymentLifecycleStatus
} from "@daoflow/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../connection";
import { deployments, deploymentSteps } from "../schema/deployments";
import { buildDeploymentIndex, buildDeploymentView } from "./deployment-record-views";

export async function getDeploymentRecord(deploymentId: string) {
  const rows = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
  if (!rows[0]) return null;

  const steps = await db
    .select()
    .from(deploymentSteps)
    .where(eq(deploymentSteps.deploymentId, deploymentId))
    .orderBy(deploymentSteps.sortOrder);

  const index = await buildDeploymentIndex(rows);

  return buildDeploymentView(
    rows[0],
    index.projectById.get(rows[0].projectId),
    index.environmentById.get(rows[0].environmentId),
    index.serverById.get(rows[0].targetServerId),
    index.serviceByKey.get(`${rows[0].projectId}:${rows[0].environmentId}:${rows[0].serviceName}`),
    steps
  );
}

export async function listDeploymentRecords(status?: string, limit = 20) {
  const baseQuery = db.select().from(deployments);
  const rows = status
    ? await (() => {
        switch (status) {
          case DeploymentHealthStatus.Healthy:
            return baseQuery
              .where(
                and(
                  eq(deployments.status, DeploymentLifecycleStatus.Completed),
                  eq(deployments.conclusion, DeploymentConclusion.Succeeded)
                )
              )
              .orderBy(desc(deployments.createdAt))
              .limit(limit);
          case DeploymentHealthStatus.Failed:
            return baseQuery
              .where(
                sql`${deployments.status} = ${DeploymentLifecycleStatus.Failed}
                    or ${deployments.conclusion} = ${DeploymentConclusion.Failed}
                    or ${deployments.conclusion} = ${DeploymentConclusion.Cancelled}`
              )
              .orderBy(desc(deployments.createdAt))
              .limit(limit);
          case DeploymentHealthStatus.Running:
            return baseQuery
              .where(
                sql`${deployments.status} in (${DeploymentLifecycleStatus.Prepare}, ${DeploymentLifecycleStatus.Deploy}, ${DeploymentLifecycleStatus.Finalize}, ${DeploymentLifecycleStatus.Running})`
              )
              .orderBy(desc(deployments.createdAt))
              .limit(limit);
          default:
            return baseQuery
              .where(
                sql`${deployments.status} not in (${DeploymentLifecycleStatus.Failed}, ${DeploymentLifecycleStatus.Completed}, ${DeploymentLifecycleStatus.Prepare}, ${DeploymentLifecycleStatus.Deploy}, ${DeploymentLifecycleStatus.Finalize}, ${DeploymentLifecycleStatus.Running})
                    and coalesce(${deployments.conclusion}, '') not in (${DeploymentConclusion.Failed}, ${DeploymentConclusion.Cancelled})`
              )
              .orderBy(desc(deployments.createdAt))
              .limit(limit);
        }
      })()
    : await baseQuery.orderBy(desc(deployments.createdAt)).limit(limit);
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
