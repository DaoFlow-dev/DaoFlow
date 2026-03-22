import { and, desc, eq } from "drizzle-orm";
import {
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { db } from "../connection";
import { deployments } from "../schema/deployments";

export async function readLatestDeploymentForService(input: {
  environmentId: string;
  serviceName: string;
}) {
  const [latestDeployment] = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.environmentId, input.environmentId),
        eq(deployments.serviceName, input.serviceName)
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  return latestDeployment ?? null;
}

export function formatCurrentDeployment(latestDeployment: typeof deployments.$inferSelect | null) {
  if (!latestDeployment) {
    return null;
  }

  return {
    id: latestDeployment.id,
    status: normalizeDeploymentStatus(latestDeployment.status, latestDeployment.conclusion),
    statusLabel: formatDeploymentStatusLabel(latestDeployment.status, latestDeployment.conclusion),
    statusTone: getDeploymentStatusTone(latestDeployment.status, latestDeployment.conclusion),
    imageTag: latestDeployment.imageTag,
    commitSha: latestDeployment.commitSha,
    createdAt: latestDeployment.createdAt.toISOString(),
    finishedAt: latestDeployment.concludedAt?.toISOString() ?? null
  };
}
