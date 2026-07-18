import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import type { WebhookDeliveryProviderType } from "../db/services/webhook-deliveries";
import type { WebhookTarget } from "./webhooks-types";

export async function listDevelopmentTaskWebhookTargets(input: {
  repoFullName: string;
  providerType: WebhookDeliveryProviderType;
  externalInstallationId?: string | null;
}): Promise<WebhookTarget[]> {
  const matchingProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.repoFullName, input.repoFullName), eq(projects.status, "active")));

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
    if (
      !provider ||
      provider.type !== input.providerType ||
      provider.status !== "active" ||
      provider.teamId !== project.teamId
    ) {
      return [];
    }

    const installation = project.gitInstallationId
      ? (installationById.get(project.gitInstallationId) ?? null)
      : null;

    if (
      !installation ||
      installation.status !== "active" ||
      installation.teamId !== project.teamId ||
      installation.providerId !== provider.id
    ) {
      return [];
    }

    if (
      input.externalInstallationId &&
      installation.installationId !== input.externalInstallationId
    ) {
      return [];
    }

    return [{ project, provider, installation }];
  });
}
