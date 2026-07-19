import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { gitProviders } from "../schema/git-providers";
import { providerFeedback, providerFeedbackTargets } from "../schema/provider-feedback";
import { environments, projects } from "../schema/projects";
import { asRecord, newId } from "./json-helpers";
import type { ProviderFeedbackContext } from "./provider-feedback-types";

export type ProviderFeedbackTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PUBLISHABLE_DEPLOYMENT_TRANSITIONS = new Set([
  "queued",
  "waiting",
  "prepare",
  "deploy",
  "finalize",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

interface ProviderFeedbackIntentSource {
  deploymentId: string;
  deploymentServiceName: string;
  projectId: string;
  projectName: string;
  projectRepoFullName: string | null;
  projectGitInstallationId: string | null;
  projectGitProviderId: string | null;
  projectDefaultBranch: string | null;
  teamId: string;
  commitSha: string | null;
  environmentId: string;
  environmentName: string;
  environmentSlug: string;
  configSnapshot: unknown;
}

export interface QueueProviderFeedbackIntentInput {
  deploymentId: string;
  transition: string;
  now?: Date;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPreviewContext(value: unknown): ProviderFeedbackContext["preview"] {
  const preview = asRecord(value);
  if (Object.keys(preview).length === 0) return null;

  const target = readString(preview, "target");
  const action = readString(preview, "action");
  const pullRequestNumber = preview.pullRequestNumber;

  return {
    target: target === "branch" || target === "pull-request" ? target : null,
    action: action === "deploy" || action === "destroy" ? action : null,
    key: readString(preview, "key"),
    branch: readString(preview, "branch"),
    pullRequestNumber:
      typeof pullRequestNumber === "number" && Number.isInteger(pullRequestNumber)
        ? pullRequestNumber
        : null,
    primaryDomain: readString(preview, "primaryDomain")
  };
}

function buildProviderFeedbackContext(
  source: ProviderFeedbackIntentSource
): ProviderFeedbackContext {
  const snapshot = asRecord(source.configSnapshot);
  const branch =
    readString(snapshot, "branch") ??
    readString(snapshot, "composeEnvBranch") ??
    source.projectDefaultBranch;

  return {
    schemaVersion: 1,
    project: {
      id: source.projectId,
      name: source.projectName
    },
    repository: {
      fullName: readString(snapshot, "repoFullName") ?? source.projectRepoFullName,
      installationId: readString(snapshot, "gitInstallationId") ?? source.projectGitInstallationId
    },
    deployment: {
      commitSha: source.commitSha,
      branch,
      serviceName: source.deploymentServiceName,
      environmentId: source.environmentId,
      environmentName: source.environmentName,
      environmentSlug: source.environmentSlug
    },
    preview: readPreviewContext(snapshot.preview)
  };
}

async function findProviderFeedbackIntentSource(
  tx: ProviderFeedbackTransaction,
  deploymentId: string
): Promise<ProviderFeedbackIntentSource | null> {
  const [source] = await tx
    .select({
      deploymentId: deployments.id,
      deploymentServiceName: deployments.serviceName,
      projectId: projects.id,
      projectName: projects.name,
      projectRepoFullName: projects.repoFullName,
      projectGitInstallationId: projects.gitInstallationId,
      projectGitProviderId: projects.gitProviderId,
      projectDefaultBranch: projects.defaultBranch,
      teamId: projects.teamId,
      commitSha: deployments.commitSha,
      environmentId: environments.id,
      environmentName: environments.name,
      environmentSlug: environments.slug,
      configSnapshot: deployments.configSnapshot
    })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .where(eq(deployments.id, deploymentId))
    .limit(1)
    .for("share");

  return source ?? null;
}

export function providerFeedbackIdempotencyKey(input: {
  deploymentId: string;
  transition: string;
}) {
  return `${input.deploymentId}:${input.transition}`;
}

async function findOrCreateProviderFeedbackTarget(
  tx: ProviderFeedbackTransaction,
  source: ProviderFeedbackIntentSource,
  now: Date
) {
  const [existing] = await tx
    .select()
    .from(providerFeedbackTargets)
    .where(eq(providerFeedbackTargets.deploymentId, source.deploymentId))
    .limit(1)
    .for("update");
  if (existing) return existing;

  if (!source.projectGitProviderId) return null;
  const [provider] = await tx
    .select({ id: gitProviders.id, kind: gitProviders.type })
    .from(gitProviders)
    .where(
      and(
        eq(gitProviders.id, source.projectGitProviderId),
        eq(gitProviders.teamId, source.teamId),
        eq(gitProviders.status, "active")
      )
    )
    .limit(1)
    .for("share");
  if (!provider) return null;

  await tx
    .insert(providerFeedbackTargets)
    .values({
      id: newId(),
      teamId: source.teamId,
      deploymentId: source.deploymentId,
      providerId: provider.id,
      providerKind: provider.kind,
      context: buildProviderFeedbackContext(source),
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoNothing({ target: providerFeedbackTargets.deploymentId });

  const [target] = await tx
    .select()
    .from(providerFeedbackTargets)
    .where(eq(providerFeedbackTargets.deploymentId, source.deploymentId))
    .limit(1)
    .for("update");
  if (!target) {
    throw new Error("Unable to create a provider feedback target.");
  }
  return target;
}

/**
 * The first intent requires an active linked provider. Once created, the target
 * keeps the provider and safe routing snapshot for every later transition.
 */
export async function queueProviderFeedbackIntent(
  tx: ProviderFeedbackTransaction,
  input: QueueProviderFeedbackIntentInput
) {
  if (!PUBLISHABLE_DEPLOYMENT_TRANSITIONS.has(input.transition)) return null;

  const source = await findProviderFeedbackIntentSource(tx, input.deploymentId);
  if (!source) return null;

  const now = input.now ?? new Date();
  const target = await findOrCreateProviderFeedbackTarget(tx, source, now);
  if (!target) return null;

  const idempotencyKey = providerFeedbackIdempotencyKey({
    deploymentId: source.deploymentId,
    transition: input.transition
  });
  await tx
    .insert(providerFeedback)
    .values({
      id: newId(),
      teamId: target.teamId,
      targetId: target.id,
      deploymentId: source.deploymentId,
      providerId: target.providerId,
      providerKind: target.providerKind,
      transition: input.transition,
      idempotencyKey,
      state: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      context: target.context,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoNothing({ target: providerFeedback.idempotencyKey });

  const [row] = await tx
    .select()
    .from(providerFeedback)
    .where(eq(providerFeedback.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ?? null;
}
