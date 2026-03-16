/**
 * execute-rollback.ts
 *
 * Finds the last N successful deployments for a service and creates a new
 * deployment that replays the target deployment's configuration.
 *
 * Rollback retention (how many successful deployments to keep as targets)
 * is configurable per service via services.config.rollbackRetention (default 3).
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { services } from "../schema/services";
import { createDeploymentRecord, type CreateDeploymentInput } from "./deployments";
import { asRecord, readString } from "./json-helpers";
import type { AppRole } from "@daoflow/shared";

const DEFAULT_ROLLBACK_RETENTION = 3;

export interface ExecuteRollbackInput {
  serviceId: string;
  targetDeploymentId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface RollbackTarget {
  deploymentId: string;
  serviceName: string;
  sourceType: string;
  commitSha: string | null;
  imageTag: string | null;
  concludedAt: string | null;
  status: string;
}

/** Get the rollback retention limit for a service. */
function getRollbackRetention(svc: typeof services.$inferSelect): number {
  const config = svc.config && typeof svc.config === "object" ? svc.config : {};
  const retention = (config as Record<string, unknown>).rollbackRetention;
  if (typeof retention === "number" && retention > 0) return retention;
  return DEFAULT_ROLLBACK_RETENTION;
}

/** List successful deployments available as rollback targets. */
export async function listRollbackTargets(serviceId: string): Promise<RollbackTarget[]> {
  const [svc] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  if (!svc) return [];

  const retention = getRollbackRetention(svc);

  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.serviceName, svc.name),
        eq(deployments.status, "completed"),
        eq(deployments.conclusion, "succeeded")
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(retention);

  return rows.map((row) => ({
    deploymentId: row.id,
    serviceName: row.serviceName,
    sourceType: row.sourceType,
    commitSha: row.commitSha,
    imageTag: row.imageTag,
    concludedAt: row.concludedAt?.toISOString() ?? null,
    status: "available"
  }));
}

/** Execute a rollback by creating a new deployment from a previous successful one. */
export async function executeRollback(input: ExecuteRollbackInput) {
  // Look up the service
  const [svc] = await db.select().from(services).where(eq(services.id, input.serviceId)).limit(1);

  if (!svc) return { status: "not_found" as const, entity: "service" };

  // Look up the target deployment
  const [target] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, input.targetDeploymentId))
    .limit(1);

  if (!target) return { status: "not_found" as const, entity: "deployment" };

  // Verify the target is a successful deployment
  if (target.status !== "completed" || target.conclusion !== "succeeded") {
    return { status: "invalid_target" as const };
  }

  // Verify the target is within retention window
  const retention = getRollbackRetention(svc);
  const targets = await listRollbackTargets(input.serviceId);
  const isInWindow = targets.some((t) => t.deploymentId === input.targetDeploymentId);
  if (!isInWindow) {
    return { status: "outside_retention" as const, retention };
  }

  // Extract deployment config from the target
  const snapshot = asRecord(target.configSnapshot);

  const deployInput: CreateDeploymentInput = {
    projectName: readString(snapshot, "projectName", target.serviceName),
    environmentName: readString(snapshot, "environmentName", "production"),
    serviceName: target.serviceName,
    sourceType: target.sourceType as "compose" | "dockerfile" | "image",
    targetServerId: target.targetServerId,
    commitSha: target.commitSha ?? "",
    imageTag: target.imageTag ?? "",
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole,
    steps: [
      { label: "Rollback preparation", detail: `Rolling back to deployment ${target.id}` },
      { label: "Restore configuration", detail: "Applying previous deployment config" },
      { label: "Deploy", detail: "Starting containers with previous config" },
      { label: "Health check", detail: "Verifying rollback succeeded" }
    ]
  };

  const deployment = await createDeploymentRecord(deployInput);
  if (!deployment) return { status: "create_failed" as const };

  return { status: "ok" as const, deployment };
}
