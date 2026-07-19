/**
 * step-management.ts — Deployment step and transition management helpers.
 *
 * Extracted from worker.ts for modularity.
 */

import { eq, sql as rawSql } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments, deploymentSteps } from "../db/schema/deployments";
import { events } from "../db/schema/audit";
import { requireDeploymentTransitionWithFeedback } from "../db/services/deployment-transition-feedback";
import type { RepositoryPreparationConfig } from "../repository-preparation";
import type { ComposeBuildPlan } from "../compose-build-plan";
import type { ComposeEnvEvidence } from "../compose-env";
import type { ComposeInputManifest } from "../compose-inputs";
import type { ComposePreviewMetadata } from "../compose-preview";
import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import type { ServiceRuntimeConfig } from "../service-runtime-config";
import { safeDeploymentFailureMessage } from "./deployment-failure-evidence";

export type DeploymentRow = typeof deployments.$inferSelect;

export async function touchDeploymentProgress(
  deploymentId: string,
  touchedAt = new Date()
): Promise<void> {
  await db
    .update(deployments)
    .set({ updatedAt: touchedAt })
    .where(eq(deployments.id, deploymentId));
}

async function touchDeploymentProgressForStep(
  stepId: number,
  touchedAt = new Date()
): Promise<void> {
  await db
    .update(deployments)
    .set({ updatedAt: touchedAt })
    .where(
      eq(
        deployments.id,
        rawSql`(
          SELECT ${deploymentSteps.deploymentId}
          FROM ${deploymentSteps}
          WHERE ${deploymentSteps.id} = ${stepId}
        )`
      )
    );
}

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
  const now = new Date();
  await db
    .update(deploymentSteps)
    .set({ status: "running", startedAt: now })
    .where(eq(deploymentSteps.id, stepId));
  await touchDeploymentProgressForStep(stepId, now);
}

export async function markStepComplete(stepId: number, detail?: string): Promise<void> {
  const now = new Date();
  await db
    .update(deploymentSteps)
    .set({
      status: "completed",
      completedAt: now,
      detail: detail ?? null
    })
    .where(eq(deploymentSteps.id, stepId));
  await touchDeploymentProgressForStep(stepId, now);
}

export async function markStepFailed(stepId: number, detail: string): Promise<void> {
  const now = new Date();
  await db
    .update(deploymentSteps)
    .set({
      status: "failed",
      completedAt: now,
      detail
    })
    .where(eq(deploymentSteps.id, stepId));
  await touchDeploymentProgressForStep(stepId, now);
}

/* ──────────────────────── Deployment Transitions ──────────────────────── */

export async function transitionDeployment(
  id: string,
  status: string,
  conclusion?: string,
  error?: unknown
): Promise<void> {
  await requireDeploymentTransitionWithFeedback({
    deploymentId: id,
    status,
    conclusion,
    error: error ? safeDeploymentFailureMessage(error) : undefined
  });
}

/* ──────────────────────── Event Emission ──────────────────────── */

export async function emitEvent(
  kind: string,
  deployment: DeploymentRow,
  summary: string,
  detail: string,
  severity: "info" | "warning" | "error" = "info"
): Promise<number | null> {
  const [event] = await db
    .insert(events)
    .values({
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
    })
    .returning({ id: events.id });
  return event?.id ?? null;
}

/* ──────────────────────── Config Snapshot ──────────────────────── */

export interface ComposeImageOverride {
  serviceName: string;
  imageReference: string;
}

export interface ConfigSnapshot extends Record<string, unknown> {
  projectName?: string;
  projectId?: string;
  teamId?: string;
  environmentName?: string;
  targetServerName?: string;
  targetServerHost?: string;
  stackName?: string;
  composeFilePath?: string;
  composeFilePaths?: string[];
  composeProfiles?: string[];
  composeServiceName?: string;
  repoUrl?: string;
  repoFullName?: string;
  gitProviderId?: string;
  gitInstallationId?: string;
  branch?: string;
  composeEnvBranch?: string;
  dockerfile?: string;
  buildContext?: string;
  ports?: string[];
  volumes?: string[];
  env?: Record<string, string>;
  network?: string;
  buildpackBuilder?: string;
  deploymentSource?: string;
  repositoryPreparation?: RepositoryPreparationConfig;
  uploadedComposeFileName?: string;
  uploadedComposeFileNames?: string[];
  uploadedContextArchiveName?: string;
  uploadedArtifactId?: string;
  composeOperation?: "up" | "down";
  preview?: ComposePreviewMetadata;
  composeImageOverride?: ComposeImageOverride;
  readinessProbe?: ComposeReadinessProbeSnapshot;
  composeBuildPlan?: ComposeBuildPlan;
  composeEnv?: ComposeEnvEvidence;
  composeInputs?: ComposeInputManifest;
  runtimeConfig?: ServiceRuntimeConfig | null;
  managedTraefikRouting?: unknown;
}

export function readConfig(deployment: DeploymentRow): ConfigSnapshot {
  const raw = deployment.configSnapshot;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ConfigSnapshot;
  }
  return {};
}
