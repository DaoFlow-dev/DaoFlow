import { eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { gitProviders } from "../schema/git-providers";
import { projects } from "../schema/projects";
import { newId } from "./json-helpers";
import { createEnvironment, createProject } from "./projects";
import { createService } from "./services";

let fixtureCounter = 0;

export async function createGitProviderFixture(input: {
  teamId: string;
  type?: string;
  status?: string;
}) {
  const id = newId();
  fixtureCounter += 1;
  await db.insert(gitProviders).values({
    id,
    teamId: input.teamId,
    type: input.type ?? "github",
    name: `Provider feedback ${fixtureCounter}`,
    status: input.status ?? "active",
    createdAt: new Date(),
    updatedAt: new Date()
  });
  return id;
}

export async function createProviderFeedbackFixture(input?: {
  teamId?: string;
  serverId?: string;
  actor?: {
    requestedByUserId: string;
    requestedByEmail: string;
    requestedByRole: "owner" | "operator" | "developer" | "viewer" | "agent";
  };
}) {
  fixtureCounter += 1;
  const teamId = input?.teamId ?? "team_foundation";
  const serverId = input?.serverId ?? "srv_foundation_1";
  const actor =
    input?.actor ??
    ({
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    } as const);
  const suffix = `${Date.now().toString(36)}-${fixtureCounter}`;
  const providerId = await createGitProviderFixture({ teamId });
  const projectResult = await createProject({
    name: `provider-feedback-project-${suffix}`,
    description: "Provider feedback fixture",
    teamId,
    ...actor
  });
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create provider feedback project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `provider-feedback-env-${suffix}`,
    targetServerId: serverId,
    ...actor
  });
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create provider feedback environment fixture.");
  }

  await db
    .update(projects)
    .set({
      gitProviderId: providerId,
      repoFullName: "daoflow/example-service",
      repoUrl: "https://example.invalid/daoflow/example-service.git",
      defaultBranch: "main",
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));

  const serviceName = `provider-feedback-service-${suffix}`;
  const serviceResult = await createService({
    name: serviceName,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    targetServerId: serverId,
    teamId,
    ...actor
  });
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create provider feedback service fixture.");
  }

  const deploymentId = newId();
  await db.insert(deployments).values({
    id: deploymentId,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    targetServerId: serverId,
    serviceId: serviceResult.service.id,
    serviceName,
    sourceType: "compose",
    commitSha: "0123456789012345678901234567890123456789",
    imageTag: "ghcr.io/daoflow/provider-feedback:test",
    status: "queued",
    configSnapshot: {
      repoFullName: "daoflow/example-service",
      repoUrl: "https://example.invalid/daoflow/example-service.git",
      gitProviderId: providerId,
      branch: "feature/provider-feedback",
      preview: {
        target: "pull-request",
        action: "deploy",
        key: "pr-227",
        branch: "feature/provider-feedback",
        pullRequestNumber: 227,
        primaryDomain: "pr-227.preview.example.invalid"
      }
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return {
    deploymentId,
    environmentId: environmentResult.environment.id,
    projectId: projectResult.project.id,
    providerId,
    teamId
  };
}
