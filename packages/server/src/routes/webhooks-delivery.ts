import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/connection";
import { auditEntries, events } from "../db/schema/audit";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import type {
  WebhookDeliveryProviderType,
  WebhookDeliveryStatus
} from "../db/services/webhook-deliveries";
import { normalizeWebhookChangedPaths } from "../webhook-auto-deploy";
import type { WebhookCommitChangeSet, WebhookTarget } from "./webhooks-types";

export function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyGitLabToken(token: string, expected: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function buildTargetResource(
  providerType: WebhookDeliveryProviderType,
  repoFullName: string
): string {
  return `webhook/${providerType}/${repoFullName}`;
}

export function collectChangedPaths(commits: WebhookCommitChangeSet[] | undefined): string[] {
  const changedPaths: string[] = [];

  for (const commit of commits ?? []) {
    changedPaths.push(
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? [])
    );
  }

  return normalizeWebhookChangedPaths(changedPaths);
}

export function determineWebhookDeliveryStatus(input: {
  deploymentCount: number;
  failedTargetCount: number;
}): WebhookDeliveryStatus {
  if (input.failedTargetCount > 0 && input.deploymentCount > 0) {
    return "partial";
  }

  if (input.failedTargetCount > 0) {
    return "failed";
  }

  if (input.deploymentCount > 0) {
    return "queued";
  }

  return "ignored";
}

export async function writeWebhookAuditEntry(input: {
  providerType: WebhookDeliveryProviderType;
  repoFullName: string;
  actorId: string;
  actorEmail: string;
  action: string;
  inputSummary: string;
  outcome: "success" | "denied" | "failure";
  metadata: Record<string, unknown>;
}) {
  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: "agent",
    targetResource: buildTargetResource(input.providerType, input.repoFullName),
    action: input.action,
    inputSummary: input.inputSummary,
    permissionScope: "deploy:start",
    outcome: input.outcome,
    metadata: input.metadata
  });
}

export async function writeWebhookProjectEvent(input: {
  projectId: string;
  kind: "webhook.delivery.queued" | "webhook.delivery.ignored" | "webhook.delivery.failed";
  summary: string;
  detail?: string;
  severity: "info" | "warning" | "error";
  metadata: Record<string, unknown>;
}) {
  await db.insert(events).values({
    kind: input.kind,
    resourceType: "project",
    resourceId: input.projectId,
    summary: input.summary,
    detail: input.detail,
    severity: input.severity,
    metadata: input.metadata
  });
}

export async function listWebhookTargets(input: {
  repoFullName: string;
  providerType: WebhookDeliveryProviderType;
  externalInstallationId?: string | null;
}): Promise<WebhookTarget[]> {
  const matchingProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.repoFullName, input.repoFullName), eq(projects.autoDeploy, true)));

  const providerIds = [
    ...new Set(
      matchingProjects
        .map((project) => project.gitProviderId)
        .filter((providerId): providerId is string => Boolean(providerId))
    )
  ];
  const installationIds = [
    ...new Set(
      matchingProjects
        .map((project) => project.gitInstallationId)
        .filter((installationId): installationId is string => Boolean(installationId))
    )
  ];

  if (providerIds.length === 0) {
    return [];
  }

  const [providerRows, installationRows] = await Promise.all([
    db.select().from(gitProviders).where(inArray(gitProviders.id, providerIds)),
    installationIds.length > 0
      ? db.select().from(gitInstallations).where(inArray(gitInstallations.id, installationIds))
      : Promise.resolve([])
  ]);

  const providerById = new Map(providerRows.map((provider) => [provider.id, provider]));
  const installationById = new Map(
    installationRows.map((installation) => [installation.id, installation])
  );

  return matchingProjects.flatMap((project) => {
    if (!project.gitProviderId) {
      return [];
    }

    const provider = providerById.get(project.gitProviderId);
    if (!provider || provider.type !== input.providerType) {
      return [];
    }

    const installation = project.gitInstallationId
      ? (installationById.get(project.gitInstallationId) ?? null)
      : null;

    if (
      input.externalInstallationId &&
      installation?.installationId !== input.externalInstallationId
    ) {
      return [];
    }

    return [{ project, provider, installation }];
  });
}
