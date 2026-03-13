import { desc, sql } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";

export interface ComposeDriftDiffRecord {
  id: string;
  field: string;
  desiredValue: string;
  actualValue: string;
  impact: string;
}

export interface ComposeDriftRecord {
  composeServiceId: string;
  environmentName: string;
  projectName: string;
  targetServerName: string;
  serviceName: string;
  composeFilePath: string;
  status: "aligned" | "drifted" | "blocked";
  summary: string;
  impactSummary: string;
  desiredImageReference: string;
  actualImageReference: string;
  desiredReplicaCount: number;
  actualReplicaCount: number;
  actualContainerState: string;
  lastCheckedAt: string;
  recommendedActions: string[];
  diffs: ComposeDriftDiffRecord[];
}

export async function listComposeReleaseCatalog(limit = 24) {
  const rows = await db
    .select()
    .from(deployments)
    .where(sql`${deployments.sourceType} = 'compose'`)
    .orderBy(desc(deployments.createdAt))
    .limit(limit);

  return {
    summary: {
      totalServices: rows.length,
      statefulServices: 0,
      healthyEnvironments: rows.filter(r => r.status === "completed").length,
      uniqueNetworks: 0
    },
    services: rows.map(r => ({
      id: r.id,
      environmentId: r.environmentId,
      environmentName: r.environmentId,
      projectName: r.projectId,
      targetServerId: r.targetServerId,
      targetServerName: r.targetServerId,
      serviceName: r.serviceName,
      composeFilePath: "",
      networkName: "",
      imageReference: r.imageTag ?? "",
      imageTag: r.imageTag,
      replicaCount: 1,
      exposedPorts: [] as string[],
      dependencies: [] as string[],
      volumeMounts: [] as string[],
      healthcheckPath: null as string | null,
      releaseTrack: "stable" as const,
      status: r.status,
      createdAt: r.createdAt.toISOString()
    }))
  };
}

export async function listComposeDriftReport(limit = 24): Promise<{
  summary: {
    totalServices: number;
    alignedServices: number;
    driftedServices: number;
    blockedServices: number;
    reviewRequired: number;
  };
  reports: ComposeDriftRecord[];
}> {
  return {
    summary: {
      totalServices: 0,
      alignedServices: 0,
      driftedServices: 0,
      blockedServices: 0,
      reviewRequired: 0
    },
    reports: []
  };
}

export async function queueComposeRelease(input: {
  composeServiceId: string;
  commitSha: string;
  imageTag?: string | null;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: string;
}) {
  return null;
}
