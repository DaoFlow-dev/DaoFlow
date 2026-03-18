/**
 * step-management.ts — Deployment step and transition management helpers.
 *
 * Extracted from worker.ts for modularity.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments, deploymentSteps } from "../db/schema/deployments";
import { events } from "../db/schema/audit";
import type { RepositoryPreparationConfig } from "../repository-preparation";
import type { ComposeEnvEvidence } from "../compose-env";

export type DeploymentRow = typeof deployments.$inferSelect;

/* ──────────────────────── Step Helpers ──────────────────────── */

export async function createStep(
  deploymentId: string,
  label: string,
  sortOrder: number
): Promise<number> {
  const [step] = await db
    .insert(deploymentSteps)
    .values({
      deploymentId,
      label,
      status: "pending",
      sortOrder
    })
    .returning({ id: deploymentSteps.id });
  return step.id;
}

export async function markStepRunning(stepId: number): Promise<void> {
  await db
    .update(deploymentSteps)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(deploymentSteps.id, stepId));
}

export async function markStepComplete(stepId: number, detail?: string): Promise<void> {
  await db
    .update(deploymentSteps)
    .set({
      status: "completed",
      completedAt: new Date(),
      detail: detail ?? null
    })
    .where(eq(deploymentSteps.id, stepId));
}

export async function markStepFailed(stepId: number, detail: string): Promise<void> {
  await db
    .update(deploymentSteps)
    .set({
      status: "failed",
      completedAt: new Date(),
      detail
    })
    .where(eq(deploymentSteps.id, stepId));
}

/* ──────────────────────── Deployment Transitions ──────────────────────── */

export async function transitionDeployment(
  id: string,
  status: string,
  conclusion?: string,
  error?: unknown
): Promise<void> {
  const now = new Date();
  const update: Record<string, unknown> = {
    status,
    updatedAt: now
  };

  if (conclusion) {
    update.conclusion = conclusion;
    update.concludedAt = now;
  }

  if (error) {
    update.error =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: typeof error === "string" ? error : JSON.stringify(error) };
  }

  await db.update(deployments).set(update).where(eq(deployments.id, id));
}

/* ──────────────────────── Event Emission ──────────────────────── */

export async function emitEvent(
  kind: string,
  deployment: DeploymentRow,
  summary: string,
  detail: string,
  severity: "info" | "error" = "info"
): Promise<void> {
  await db.insert(events).values({
    kind,
    resourceType: "deployment",
    resourceId: deployment.id,
    summary,
    detail,
    severity,
    metadata: {
      serviceName: deployment.serviceName,
      actorLabel: "execution-worker"
    },
    createdAt: new Date()
  });
}

/* ──────────────────────── Config Snapshot ──────────────────────── */

export interface ConfigSnapshot extends Record<string, unknown> {
  projectName?: string;
  environmentName?: string;
  targetServerName?: string;
  targetServerHost?: string;
  composeFilePath?: string;
  composeServiceName?: string;
  repoUrl?: string;
  repoFullName?: string;
  gitProviderId?: string;
  gitInstallationId?: string;
  branch?: string;
  dockerfile?: string;
  buildContext?: string;
  ports?: string[];
  volumes?: string[];
  env?: Record<string, string>;
  network?: string;
  deploymentSource?: string;
  repositoryPreparation?: RepositoryPreparationConfig;
  uploadedComposeFileName?: string;
  uploadedContextArchiveName?: string;
  composeEnv?: ComposeEnvEvidence;
}

export function readConfig(deployment: DeploymentRow): ConfigSnapshot {
  const raw = deployment.configSnapshot;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ConfigSnapshot;
  }
  return {};
}
