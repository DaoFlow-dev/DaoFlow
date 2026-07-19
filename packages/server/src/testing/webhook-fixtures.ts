import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "../db/connection";
import { encrypt } from "../db/crypto";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { encodeGitInstallationPermissions } from "../db/services/git-providers";
import { createEnvironment, createProject } from "../db/services/projects";
import { createService } from "../db/services/services";

export function toRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function mockGitHubSourceFetch(input: {
  repoFullName: string;
  installationId: string;
  branch?: string;
  composePath?: string;
}) {
  const branch = input.branch ?? "main";
  const composePath = input.composePath ?? "docker-compose.yml";
  const encodedComposePath = encodeURIComponent(composePath);

  return (request: string | URL | Request) => {
    const url = toRequestUrl(request);
    if (url.endsWith(`/app/installations/${input.installationId}/access_tokens`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ token: "ghs_webhook_validation" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    if (url.endsWith(`/repos/${input.repoFullName}`)) {
      return Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    }
    if (url.endsWith(`/repos/${input.repoFullName}/branches/${encodeURIComponent(branch)}`)) {
      return Promise.resolve(new Response(JSON.stringify({ name: branch }), { status: 200 }));
    }
    if (
      url.includes(
        `/repos/${input.repoFullName}/contents/${encodedComposePath}?ref=${encodeURIComponent(branch)}`
      )
    ) {
      return Promise.resolve(new Response(JSON.stringify({ path: composePath }), { status: 200 }));
    }
    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

export function mockGitLabSourceFetch(input: {
  repoFullName: string;
  branch?: string;
  composePath?: string;
  projectId: number;
}) {
  const branch = input.branch ?? "main";
  const composePath = input.composePath ?? "docker-compose.yml";
  const encodedRepoFullName = encodeURIComponent(input.repoFullName);
  const encodedProjectId = encodeURIComponent(String(input.projectId));
  const encodedBranch = encodeURIComponent(branch);
  const encodedComposePath = encodeURIComponent(composePath);

  return (request: string | URL | Request) => {
    const url = toRequestUrl(request);
    if (url.endsWith(`/projects/${encodedRepoFullName}`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: input.projectId }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    if (url.endsWith(`/projects/${encodedProjectId}/repository/branches/${encodedBranch}`)) {
      return Promise.resolve(new Response(JSON.stringify({ name: branch }), { status: 200 }));
    }
    if (
      url.includes(
        `/projects/${encodedProjectId}/repository/files/${encodedComposePath}?ref=${encodedBranch}`
      )
    ) {
      return Promise.resolve(
        new Response(JSON.stringify({ file_path: composePath }), { status: 200 })
      );
    }
    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

export async function createGitHubComposeWebhookFixture(input: {
  suffix: string;
  repoFullName: string;
  serviceName: string;
  externalInstallationId: string;
  webhookSecret: string;
  autoDeployBranch?: string;
  watchedPaths?: string[];
}) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
  const providerId = `gitprov_gh_${input.suffix}`.slice(0, 32);
  const installationId = `gitinst_gh_${input.suffix}`.slice(0, 32);
  const projectResult = await createProject({
    name: `GitHub Webhook ${input.suffix}`,
    repoUrl: `https://github.com/${input.repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") throw new Error("Failed to create GitHub webhook project.");

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: "production",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environmentResult.status !== "ok") throw new Error("Failed to create webhook environment.");
  const serviceResult = await createService({
    name: input.serviceName,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (serviceResult.status !== "ok") throw new Error("Failed to create webhook service.");

  await db.insert(gitProviders).values({
    id: providerId,
    teamId: "team_foundation",
    type: "github",
    name: `GitHub Webhook ${input.suffix}`,
    appId: `app-${input.suffix}`.slice(0, 40),
    privateKeyEncrypted: encrypt(privateKeyPem),
    webhookSecret: input.webhookSecret,
    status: "active",
    updatedAt: new Date()
  });
  await db.insert(gitInstallations).values({
    id: installationId,
    teamId: "team_foundation",
    providerId,
    installationId: input.externalInstallationId,
    accountName: "example",
    accountType: "organization",
    repositorySelection: "selected",
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });
  await configureProject({
    projectId: projectResult.project.id,
    config: projectResult.project.config,
    repoFullName: input.repoFullName,
    providerId,
    installationId,
    autoDeployBranch: input.autoDeployBranch,
    watchedPaths: input.watchedPaths
  });
  return {
    projectId: projectResult.project.id,
    providerId,
    installationId,
    externalInstallationId: input.externalInstallationId,
    serviceName: input.serviceName
  };
}

export async function createGitLabComposeWebhookFixture(input: {
  suffix: string;
  repoFullName: string;
  serviceName: string;
  webhookSecret: string;
  autoDeployBranch?: string;
  watchedPaths?: string[];
  projectApiId: number;
}) {
  const providerId = `gitprov_gl_${input.suffix}`.slice(0, 32);
  const installationId = `gitinst_gl_${input.suffix}`.slice(0, 32);
  const projectResult = await createProject({
    name: `GitLab Webhook ${input.suffix}`,
    repoUrl: `https://gitlab.com/${input.repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") throw new Error("Failed to create GitLab webhook project.");
  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: "production",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environmentResult.status !== "ok") throw new Error("Failed to create webhook environment.");
  const serviceResult = await createService({
    name: input.serviceName,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (serviceResult.status !== "ok") throw new Error("Failed to create webhook service.");

  await db.insert(gitProviders).values({
    id: providerId,
    teamId: "team_foundation",
    type: "gitlab",
    name: `GitLab Webhook ${input.suffix}`,
    webhookSecret: input.webhookSecret,
    status: "active",
    updatedAt: new Date()
  });
  await db.insert(gitInstallations).values({
    id: installationId,
    teamId: "team_foundation",
    providerId,
    installationId: String(input.projectApiId),
    accountName: "example",
    accountType: "group",
    repositorySelection: "all",
    permissions: encodeGitInstallationPermissions({ accessToken: `glpat-${input.suffix}` }),
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });
  await configureProject({
    projectId: projectResult.project.id,
    config: projectResult.project.config,
    repoFullName: input.repoFullName,
    providerId,
    installationId,
    autoDeployBranch: input.autoDeployBranch,
    watchedPaths: input.watchedPaths
  });
  return {
    projectId: projectResult.project.id,
    providerId,
    installationId,
    serviceName: input.serviceName
  };
}

async function configureProject(input: {
  projectId: string;
  config: unknown;
  repoFullName: string;
  providerId: string;
  installationId: string;
  autoDeployBranch?: string;
  watchedPaths?: string[];
}) {
  const config = input.config && typeof input.config === "object" ? input.config : {};
  await db
    .update(projects)
    .set({
      repoFullName: input.repoFullName,
      sourceType: "compose",
      gitProviderId: input.providerId,
      gitInstallationId: input.installationId,
      autoDeploy: true,
      autoDeployBranch: input.autoDeployBranch ?? "main",
      defaultBranch: "main",
      config:
        input.watchedPaths && input.watchedPaths.length > 0
          ? { ...config, webhookAutoDeploy: { watchedPaths: input.watchedPaths } }
          : config,
      updatedAt: new Date()
    })
    .where(eq(projects.id, input.projectId));
}
