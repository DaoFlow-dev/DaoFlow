import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { services } from "../db/schema/services";
import { tunnelRoutes, tunnels } from "../db/schema/tunnels";
import { encrypt } from "../db/crypto";
import { createGitLabCredentialStorage } from "../db/services/gitlab-credentials";
import { createEnvironment, createProject } from "../db/services/projects";
import type { ProviderFeedbackAdapterInput } from "./provider-feedback-adapter-registry";

let fixtureCounter = 0;

export async function createGitLabProviderFeedbackFixture(input?: {
  credentialKind?: "oauth" | "api_token" | "deploy_token" | "unavailable";
  preview?: "merge-request" | "branch" | "none";
  host?: "gitlab.com" | "self-hosted";
}) {
  fixtureCounter += 1;
  const suffix = `${Date.now()}-${fixtureCounter}`;
  const providerId = `gl-provider-${suffix}`.slice(0, 32);
  const installationId = `gl-install-${suffix}`.slice(0, 32);
  const tunnelId = `gl-tunnel-${suffix}`.slice(0, 32);
  const serviceId = `gl-service-${suffix}`.slice(0, 32);
  const domain = `mr-${fixtureCounter}.preview.example.test`;
  const projectResult = await createProject({
    name: `GitLab feedback ${suffix}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") throw new Error("Unable to create GitLab feedback project.");
  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `Preview ${suffix}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environmentResult.status !== "ok") {
    throw new Error("Unable to create GitLab feedback environment.");
  }

  const credentialKind = input?.credentialKind ?? "api_token";
  const gitLabDotCom = input?.host === "gitlab.com";
  await db.insert(gitProviders).values({
    id: providerId,
    teamId: "team_foundation",
    type: "gitlab",
    name: `GitLab feedback ${suffix}`,
    baseUrl: gitLabDotCom ? "https://gitlab.com" : "https://gitlab.public.test/gitlab",
    internalBaseUrl: gitLabDotCom ? null : "http://gitlab.internal.test/gitlab",
    clientId: credentialKind === "oauth" ? "gitlab-feedback-client" : null,
    clientSecretEncrypted:
      credentialKind === "oauth" ? encrypt("gitlab-feedback-client-secret") : null,
    status: "active",
    updatedAt: new Date()
  });
  await db.insert(gitInstallations).values({
    id: installationId,
    teamId: "team_foundation",
    providerId,
    installationId: `gitlab-${fixtureCounter}`,
    accountName: "example-group",
    accountType: "group",
    repositorySelection: "selected",
    ...(credentialKind === "oauth"
      ? createGitLabCredentialStorage({
          kind: "oauth",
          accessToken: "expired-access-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() - 60_000).toISOString()
        })
      : credentialKind === "api_token"
        ? createGitLabCredentialStorage({ kind: "api_token", token: "glpat-feedback-token" })
        : credentialKind === "deploy_token"
          ? createGitLabCredentialStorage({
              kind: "deploy_token",
              username: "deploy-user",
              token: "deploy-token"
            })
          : {}),
    status: "active",
    updatedAt: new Date()
  });
  await db
    .update(projects)
    .set({
      gitProviderId: providerId,
      gitInstallationId: installationId,
      repoFullName: "group/platform/preview-service",
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));
  await db.insert(services).values({
    id: serviceId,
    name: "api",
    slug: `api-${fixtureCounter}`,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    targetServerId: "srv_foundation_1",
    config: {},
    updatedAt: new Date()
  });
  await db.insert(tunnels).values({
    id: tunnelId,
    name: `GitLab feedback ${suffix}`,
    teamId: "team_foundation",
    status: "active",
    updatedAt: new Date()
  });
  await db.insert(tunnelRoutes).values({
    id: `gl-route-${suffix}`.slice(0, 32),
    tunnelId,
    hostname: domain,
    service: "api",
    status: "active",
    updatedAt: new Date()
  });

  const preview =
    input?.preview === "none"
      ? null
      : input?.preview === "branch"
        ? {
            target: "branch" as const,
            action: "deploy" as const,
            key: "branch-feature-preview",
            branch: "feature/preview",
            pullRequestNumber: null,
            primaryDomain: domain
          }
        : {
            target: "pull-request" as const,
            action: "deploy" as const,
            key: "mr-47",
            branch: "feature/preview",
            pullRequestNumber: 47,
            primaryDomain: domain
          };
  const createInput = (
    overrides?: Partial<ProviderFeedbackAdapterInput>
  ): ProviderFeedbackAdapterInput => ({
    feedbackId: `feedback-${suffix}`.slice(0, 32),
    targetId: `target-${suffix}`.slice(0, 32),
    idempotencyKey: `deployment-${suffix}:queued`,
    teamId: "team_foundation",
    deploymentId: `deployment-${suffix}`.slice(0, 32),
    transition: "queued",
    provider: { id: providerId, kind: "gitlab" },
    context: {
      schemaVersion: 1,
      project: { id: projectResult.project.id, name: projectResult.project.name },
      repository: { fullName: "group/platform/preview-service", installationId },
      deployment: {
        commitSha: "0123456789012345678901234567890123456789",
        branch: "feature/preview",
        serviceName: "api",
        environmentId: environmentResult.environment.id,
        environmentName: environmentResult.environment.name,
        environmentSlug: environmentResult.environment.slug ?? "preview"
      },
      preview
    },
    externalIds: {
      externalDeploymentId: null,
      externalStatusId: null,
      externalCommentId: null
    },
    attemptCount: 1,
    signal: new AbortController().signal,
    ...overrides
  });

  return { createInput, domain };
}
