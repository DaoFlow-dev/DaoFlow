import { randomUUID } from "node:crypto";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../connection";
import { deployments, deploymentSteps, deploymentLogs } from "../schema/deployments";
import { servers } from "../schema/servers";
import type { AppRole } from "@daoflow/shared";

export type DeploymentStatus =
  | "queued"
  | "prepare"
  | "deploy"
  | "finalize"
  | "completed"
  | "failed";
export type DeploymentSourceType = "compose" | "dockerfile" | "image";

const id = () => randomUUID().replace(/-/g, "").slice(0, 32);

export interface CreateDeploymentInput {
  projectName: string;
  environmentName: string;
  serviceName: string;
  sourceType: DeploymentSourceType;
  targetServerId: string;
  commitSha: string;
  imageTag: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
  steps: readonly { label: string; detail: string }[];
}

export async function createDeploymentRecord(input: CreateDeploymentInput) {
  const server = await db
    .select()
    .from(servers)
    .where(eq(servers.id, input.targetServerId))
    .limit(1);
  if (!server[0]) return null;

  const deploymentId = id();
  await db.insert(deployments).values({
    id: deploymentId,
    projectId: deploymentId,
    environmentId: deploymentId,
    targetServerId: input.targetServerId,
    serviceName: input.serviceName,
    sourceType: input.sourceType,
    commitSha: input.commitSha,
    imageTag: input.imageTag,
    configSnapshot: {},
    status: "queued",
    trigger: "user",
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });

  for (let i = 0; i < input.steps.length; i++) {
    await db.insert(deploymentSteps).values({
      deploymentId,
      label: input.steps[i].label,
      detail: input.steps[i].detail,
      status: "pending"
    });
  }

  return getDeploymentRecord(deploymentId);
}

export async function getDeploymentRecord(deploymentId: string) {
  const rows = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);

  if (!rows[0]) return null;

  const steps = await db
    .select()
    .from(deploymentSteps)
    .where(eq(deploymentSteps.deploymentId, deploymentId))
    .orderBy(deploymentSteps.sortOrder);

  const dep = rows[0];
  return {
    ...dep,
    projectName: dep.projectId,
    environmentName: dep.environmentId,
    targetServerName: dep.targetServerId,
    targetServerHost: dep.targetServerId,
    steps: steps.map((s) => ({
      ...s,
      position: s.sortOrder,
      startedAt: s.startedAt?.toISOString() ?? new Date().toISOString(),
      finishedAt: s.completedAt?.toISOString() ?? null
    }))
  };
}

export async function listDeploymentRecords(status?: string, limit = 20) {
  const query = status
    ? db.select().from(deployments).where(eq(deployments.status, status))
    : db.select().from(deployments);

  const rows = await query.orderBy(desc(deployments.createdAt)).limit(limit);
  return rows.map((d) => ({
    ...d,
    projectName: d.projectId,
    environmentName: d.environmentId,
    targetServerName: d.targetServerId,
    targetServerHost: d.targetServerId,
    createdAt: d.createdAt.toISOString(),
    startedAt: d.createdAt?.toISOString() ?? d.createdAt.toISOString(),
    finishedAt: d.concludedAt?.toISOString() ?? null
  }));
}

export async function listDeploymentLogs(deploymentId?: string, limit = 18) {
  const query = deploymentId
    ? db.select().from(deploymentLogs).where(eq(deploymentLogs.deploymentId, deploymentId))
    : db.select().from(deploymentLogs);

  const logs = await query.orderBy(desc(deploymentLogs.createdAt)).limit(limit);

  const countResult = await db.select({ count: sql<number>`count(*)` }).from(deploymentLogs);
  const stderrResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(deploymentLogs)
    .where(eq(deploymentLogs.level, "error"));

  return {
    summary: {
      totalLines: Number(countResult[0]?.count ?? 0),
      stderrLines: Number(stderrResult[0]?.count ?? 0),
      deploymentCount: 0
    },
    lines: logs.map((l) => ({
      ...l,
      stream: l.level === "error" ? ("stderr" as const) : ("stdout" as const),
      lineNumber: l.id,
      createdAt: l.createdAt.toISOString(),
      projectName: "",
      environmentName: "",
      serviceName: ""
    }))
  };
}

export async function listDeploymentInsights(limit = 6) {
  const rows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.status, "failed"))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);

  return rows.map((d) => ({
    deploymentId: d.id,
    projectName: d.projectId,
    environmentName: d.environmentId,
    serviceName: d.serviceName,
    status: d.status,
    summary: `Deployment ${d.id} failed`,
    suspectedRootCause: d.error ? JSON.stringify(d.error) : "Unknown",
    safeActions: ["review logs", "check server health", "retry deployment"],
    evidence: [] as { kind: string; id: string; title: string; detail: string }[],
    healthyBaseline: null as {
      deploymentId: string;
      commitSha: string;
      imageTag: string;
      finishedAt: string | null;
    } | null
  }));
}

export async function listDeploymentRollbackPlans(limit = 6) {
  const rows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.conclusion, "succeeded"))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);

  return rows.map((d) => ({
    deploymentId: d.id,
    projectName: d.projectId,
    environmentName: d.environmentId,
    serviceName: d.serviceName,
    currentStatus: d.status,
    isAvailable: true,
    reason: "Previous successful deployment available for rollback",
    targetDeploymentId: d.id,
    targetCommitSha: d.commitSha,
    targetImageTag: d.imageTag,
    checks: ["verify target image exists", "check volume compatibility"],
    steps: ["stop current container", "start rollback container", "health check"]
  }));
}
