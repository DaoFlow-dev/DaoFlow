import { and, eq, sql as rawSql } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { deployments } from "../schema/deployments";
import type { DeploymentRow } from "../../worker/step-management";
import { DeploymentLifecycleStatus, type AppRole } from "@daoflow/shared";
import {
  DeploymentCancellationError,
  readDeploymentCancellationSnapshot
} from "../../deployment-cancellation";

const ACTIVE_DEPLOYMENT_STATUSES = [
  DeploymentLifecycleStatus.Prepare,
  DeploymentLifecycleStatus.Deploy,
  DeploymentLifecycleStatus.Finalize,
  DeploymentLifecycleStatus.Running
] as const;

const ACTIVE_DEPLOYMENT_STATUS_SQL = rawSql.join(
  ACTIVE_DEPLOYMENT_STATUSES.map((status) => rawSql`${status}`),
  rawSql`, `
);

export interface DeploymentExecutionActor {
  actorId: string;
  actorEmail: string;
  actorRole: AppRole;
  actorLabel: string;
}

export interface SpecificDeploymentClaimResult {
  status: "claimed" | "waiting" | "terminal" | "missing";
  deployment?: DeploymentRow;
}

function activeDeploymentConflictSql(candidateTable: string, activeTable: string) {
  return rawSql`
    NOT EXISTS (
      SELECT 1
      FROM ${deployments} AS ${rawSql.raw(activeTable)}
      WHERE ${rawSql.raw(activeTable)}.project_id = ${rawSql.raw(candidateTable)}.project_id
        AND ${rawSql.raw(activeTable)}.environment_id = ${rawSql.raw(candidateTable)}.environment_id
        AND ${rawSql.raw(activeTable)}.service_name = ${rawSql.raw(candidateTable)}.service_name
        AND ${rawSql.raw(activeTable)}.id <> ${rawSql.raw(candidateTable)}.id
        AND ${rawSql.raw(activeTable)}.status IN (${ACTIVE_DEPLOYMENT_STATUS_SQL})
    )
  `;
}

async function recordExecutionClaimAudit(
  deployment: DeploymentRow,
  actor: DeploymentExecutionActor
): Promise<void> {
  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    targetResource: `deployment/${deployment.id}`,
    action: "deployment.execute",
    inputSummary: `${actor.actorLabel} claimed deployment ${deployment.id} for ${deployment.serviceName}`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      resourceType: "deployment",
      resourceId: deployment.id,
      resourceLabel: deployment.serviceName,
      detail: `${actor.actorLabel} claimed deployment ${deployment.id}`
    }
  });
}

export async function claimNextQueuedDeploymentForExecution(
  actor: DeploymentExecutionActor
): Promise<DeploymentRow | null> {
  const now = new Date();
  const [job] = await db
    .update(deployments)
    .set({ status: DeploymentLifecycleStatus.Prepare, updatedAt: now })
    .where(
      and(
        eq(deployments.status, DeploymentLifecycleStatus.Queued),
        eq(
          deployments.id,
          rawSql`
            (
              SELECT candidate.id
              FROM ${deployments} AS candidate
              WHERE candidate.status = ${DeploymentLifecycleStatus.Queued}
                AND ${activeDeploymentConflictSql("candidate", "active")}
              ORDER BY candidate.created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
          `
        )
      )
    )
    .returning();

  if (!job) {
    return null;
  }

  await recordExecutionClaimAudit(job, actor);
  return job;
}

export async function claimDeploymentForExecution(
  deploymentId: string,
  actor: DeploymentExecutionActor
): Promise<SpecificDeploymentClaimResult> {
  const [existing] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);

  if (!existing) {
    return { status: "missing" };
  }

  if (
    ACTIVE_DEPLOYMENT_STATUSES.includes(
      existing.status as (typeof ACTIVE_DEPLOYMENT_STATUSES)[number]
    )
  ) {
    return { status: "claimed", deployment: existing };
  }

  if (existing.status !== DeploymentLifecycleStatus.Queued) {
    return { status: "terminal", deployment: existing };
  }

  const now = new Date();
  const [claimed] = await db
    .update(deployments)
    .set({ status: DeploymentLifecycleStatus.Prepare, updatedAt: now })
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(deployments.status, DeploymentLifecycleStatus.Queued),
        activeDeploymentConflictSql("deployments", "active")
      )
    )
    .returning();

  if (claimed) {
    await recordExecutionClaimAudit(claimed, actor);
    return { status: "claimed", deployment: claimed };
  }

  const [current] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);

  if (!current) {
    return { status: "missing" };
  }

  if (current.status === DeploymentLifecycleStatus.Queued) {
    return { status: "waiting", deployment: current };
  }

  if (
    ACTIVE_DEPLOYMENT_STATUSES.includes(
      current.status as (typeof ACTIVE_DEPLOYMENT_STATUSES)[number]
    )
  ) {
    return { status: "claimed", deployment: current };
  }

  return { status: "terminal", deployment: current };
}

export async function throwIfDeploymentCancellationRequested(deploymentId: string): Promise<void> {
  const [deployment] = await db
    .select({ configSnapshot: deployments.configSnapshot })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);

  const snapshot = readDeploymentCancellationSnapshot(deployment?.configSnapshot);
  if (snapshot) {
    throw new DeploymentCancellationError(snapshot);
  }
}
