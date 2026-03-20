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
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import { createDeploymentRecord, type CreateDeploymentInput } from "./deployments";
import { dispatchDeploymentExecution } from "./deployment-dispatch";
import { asRecord, readString } from "./json-helpers";
import { resolveServiceForUser } from "./scoped-services";
import type { AppRole } from "@daoflow/shared";
import { extractReplayableConfigSnapshot, resolveComposeImageOverride } from "./deployment-source";

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
async function listRollbackTargetsForService(
  svc: typeof services.$inferSelect
): Promise<RollbackTarget[]> {
  const retention = getRollbackRetention(svc);

  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, svc.projectId),
        eq(deployments.environmentId, svc.environmentId),
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

/** List successful deployments available as rollback targets for the caller's service scope. */
export async function listRollbackTargets(
  serviceRef: string,
  requestedByUserId: string
): Promise<RollbackTarget[]> {
  const svc = await resolveServiceForUser(serviceRef, requestedByUserId);
  return listRollbackTargetsForService(svc);
}

/** Execute a rollback by creating a new deployment from a previous successful one. */
export async function executeRollback(input: ExecuteRollbackInput) {
  const svc = await resolveServiceForUser(input.serviceId, input.requestedByUserId).catch(
    () => null
  );
  if (!svc) return { status: "not_found" as const, entity: "service" };

  const [project, environment] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, svc.projectId)).limit(1),
    db.select().from(environments).where(eq(environments.id, svc.environmentId)).limit(1)
  ]);
  if (!project[0]) return { status: "not_found" as const, entity: "project" };
  if (!environment[0]) return { status: "not_found" as const, entity: "environment" };

  // Look up the target deployment
  const [target] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, input.targetDeploymentId))
    .limit(1);

  if (!target) return { status: "not_found" as const, entity: "deployment" };

  if (
    target.projectId !== svc.projectId ||
    target.environmentId !== svc.environmentId ||
    target.serviceName !== svc.name
  ) {
    return { status: "not_found" as const, entity: "deployment" };
  }

  // Verify the target is a successful deployment
  if (target.status !== "completed" || target.conclusion !== "succeeded") {
    return { status: "invalid_target" as const };
  }

  // Verify the target is within retention window
  const retention = getRollbackRetention(svc);
  const targets = await listRollbackTargetsForService(svc);
  const isInWindow = targets.some((t) => t.deploymentId === input.targetDeploymentId);
  if (!isInWindow) {
    return { status: "outside_retention" as const, retention };
  }

  // Extract deployment config from the target
  const snapshot = asRecord(target.configSnapshot);
  const configSnapshot = extractReplayableConfigSnapshot(snapshot);
  const composeImageOverride =
    target.sourceType === "compose"
      ? resolveComposeImageOverride({
          serviceName: svc.name,
          composeServiceName: svc.composeServiceName,
          effectiveImageTag: target.imageTag,
          serviceImageReference: svc.imageReference,
          existingOverride: snapshot.composeImageOverride
        })
      : undefined;

  if (composeImageOverride) {
    configSnapshot.composeImageOverride = composeImageOverride;
  } else {
    delete configSnapshot.composeImageOverride;
  }

  const deployInput: CreateDeploymentInput = {
    projectName: readString(snapshot, "projectName", project[0].name),
    environmentName: readString(snapshot, "environmentName", environment[0].name),
    serviceName: target.serviceName,
    sourceType: target.sourceType as "compose" | "dockerfile" | "image",
    targetServerId: target.targetServerId,
    commitSha: target.commitSha ?? "",
    imageTag: target.imageTag ?? "",
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole,
    envVarsEncrypted: target.envVarsEncrypted,
    configSnapshot,
    steps: [
      {
        label: "Rollback preparation",
        detail: `Resolved rollback target ${target.id} and replayed its persisted deployment snapshot.`
      },
      {
        label: "Queue execution handoff",
        detail: "Dispatch the rollback deployment to the execution plane."
      }
    ]
  };

  const deployment = await createDeploymentRecord(deployInput);
  if (!deployment) return { status: "create_failed" as const };
  await dispatchDeploymentExecution(deployment);

  return { status: "ok" as const, deployment };
}
