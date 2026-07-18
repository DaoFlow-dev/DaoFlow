import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { getGitInstallation, readGitInstallationAccessToken } from "../db/services/git-providers";
import { fetchGitHubInstallationAccessToken } from "../db/services/github-app-auth";
import { resolveGitLabInstallationAccessToken } from "../db/services/gitlab-installation-auth";
import { resolveActiveProjectRepositoryCredential } from "../db/services/repository-credentials";
import {
  hasRepositoryPreparation,
  readRepositoryPreparationConfig,
  type RepositoryPreparationConfig
} from "../repository-preparation";
import type { ConfigSnapshot } from "./step-management";

type GitConfigEntry = {
  key: string;
  value: string;
};

export interface CheckoutSpec {
  repoUrl: string;
  branch: string;
  displayLabel: string;
  gitConfig: GitConfigEntry[];
  sshPrivateKey?: string;
  repositoryPreparation: RepositoryPreparationConfig;
  requiresLocalMaterialization: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function authorizationHeader(value: string) {
  return { key: "http.extraHeader", value };
}

function buildGitHubRepoUrl(baseUrl: string | null, repoFullName: string): string {
  return `${trimTrailingSlash(baseUrl ?? "https://github.com")}/${repoFullName}.git`;
}

function buildGitLabRepoUrl(baseUrl: string | null, repoFullName: string): string {
  return `${trimTrailingSlash(baseUrl ?? "https://gitlab.com")}/${repoFullName}.git`;
}

async function resolveProviderCheckoutTeamId(config: ConfigSnapshot): Promise<string> {
  if (config.projectId) {
    const [project] = await db
      .select({
        teamId: projects.teamId,
        gitProviderId: projects.gitProviderId,
        gitInstallationId: projects.gitInstallationId
      })
      .from(projects)
      .where(eq(projects.id, config.projectId))
      .limit(1);

    if (!project) {
      throw new Error(`Project ${config.projectId} not found for provider checkout.`);
    }
    if (
      project.gitProviderId !== config.gitProviderId ||
      project.gitInstallationId !== config.gitInstallationId
    ) {
      throw new Error(
        "Project source no longer matches its durable provider installation binding."
      );
    }
    return project.teamId;
  }

  if (!config.teamId) {
    throw new Error("Provider checkout requires a durable project or team ownership context.");
  }

  return config.teamId;
}

async function resolveGitHubCheckoutSpec(
  config: ConfigSnapshot,
  teamId: string
): Promise<CheckoutSpec> {
  const providerId = config.gitProviderId;
  const installationId = config.gitInstallationId;
  const repoFullName = config.repoFullName;
  if (!providerId || !installationId || !repoFullName) {
    throw new Error("GitHub source is missing provider, installation, or repository metadata.");
  }

  const [providerRows, installation] = await Promise.all([
    db
      .select()
      .from(gitProviders)
      .where(and(eq(gitProviders.id, providerId), eq(gitProviders.teamId, teamId)))
      .limit(1),
    getGitInstallation(installationId, teamId)
  ]);
  const provider = providerRows[0];

  if (!provider || provider.type !== "github") {
    throw new Error(`Git provider ${providerId} not found.`);
  }
  if (!installation || installation.providerId !== providerId || installation.teamId !== teamId) {
    throw new Error(`Git installation ${installationId} not found for provider ${providerId}.`);
  }

  const accessToken = await fetchGitHubInstallationAccessToken({ provider, installation });
  const repositoryPreparation = readRepositoryPreparationConfig(config.repositoryPreparation);

  return {
    repoUrl: buildGitHubRepoUrl(provider.baseUrl, repoFullName),
    branch: config.branch ?? "main",
    displayLabel: repoFullName,
    gitConfig: [
      authorizationHeader(`AUTHORIZATION: basic ${toBase64(`x-access-token:${accessToken}`)}`)
    ],
    repositoryPreparation,
    requiresLocalMaterialization: true
  };
}

async function resolveGitLabCheckoutSpec(
  config: ConfigSnapshot,
  teamId: string
): Promise<CheckoutSpec> {
  const providerId = config.gitProviderId;
  const installationId = config.gitInstallationId;
  const repoFullName = config.repoFullName;
  if (!providerId || !installationId || !repoFullName) {
    throw new Error("GitLab source is missing provider, installation, or repository metadata.");
  }

  const [providerRows, installation] = await Promise.all([
    db
      .select()
      .from(gitProviders)
      .where(and(eq(gitProviders.id, providerId), eq(gitProviders.teamId, teamId)))
      .limit(1),
    getGitInstallation(installationId, teamId)
  ]);
  const provider = providerRows[0];

  if (!provider || provider.type !== "gitlab") {
    throw new Error(`Git provider ${providerId} not found.`);
  }
  if (!installation || installation.providerId !== providerId || installation.teamId !== teamId) {
    throw new Error(`Git installation ${installationId} not found for provider ${providerId}.`);
  }

  const accessToken = await resolveGitLabInstallationAccessToken({ provider, installation });
  if (!accessToken) {
    throw new Error(`GitLab installation ${installationId} does not have a usable access token.`);
  }

  const repositoryPreparation = readRepositoryPreparationConfig(config.repositoryPreparation);
  return {
    repoUrl: buildGitLabRepoUrl(provider.baseUrl, repoFullName),
    branch: config.branch ?? "main",
    displayLabel: repoFullName,
    gitConfig: [authorizationHeader(`Authorization: Bearer ${accessToken}`)],
    repositoryPreparation,
    requiresLocalMaterialization: true
  };
}

async function resolveGenericOAuthCheckoutSpec(
  config: ConfigSnapshot,
  providerType: string,
  teamId: string
): Promise<CheckoutSpec> {
  const providerId = config.gitProviderId;
  const installationId = config.gitInstallationId;
  const repoFullName = config.repoFullName;
  if (!providerId || !installationId || !repoFullName) {
    throw new Error(
      `${providerType} source is missing provider, installation, or repository metadata.`
    );
  }

  const [providerRows, installation] = await Promise.all([
    db
      .select()
      .from(gitProviders)
      .where(and(eq(gitProviders.id, providerId), eq(gitProviders.teamId, teamId)))
      .limit(1),
    getGitInstallation(installationId, teamId)
  ]);
  const provider = providerRows[0];

  if (!provider) throw new Error(`Git provider ${providerId} not found.`);
  if (!installation || installation.providerId !== providerId || installation.teamId !== teamId) {
    throw new Error(`Git installation ${installationId} not found for provider ${providerId}.`);
  }

  const accessToken = readGitInstallationAccessToken(installation);
  if (!accessToken) {
    throw new Error(
      `${providerType} installation ${installationId} does not have a usable access token.`
    );
  }

  const baseUrl = provider.baseUrl?.replace(/\/$/, "");
  const repoUrl =
    providerType === "bitbucket"
      ? `https://bitbucket.org/${repoFullName}.git`
      : baseUrl
        ? `${baseUrl}/${repoFullName}.git`
        : `https://${providerType}.com/${repoFullName}.git`;
  const repositoryPreparation = readRepositoryPreparationConfig(config.repositoryPreparation);

  return {
    repoUrl,
    branch: config.branch ?? "main",
    displayLabel: repoFullName,
    gitConfig: [authorizationHeader(`Authorization: Bearer ${accessToken}`)],
    repositoryPreparation,
    requiresLocalMaterialization: true
  };
}

export async function resolveCheckoutSpec(config: ConfigSnapshot): Promise<CheckoutSpec | null> {
  const repositoryPreparation = readRepositoryPreparationConfig(config.repositoryPreparation);

  if (config.gitProviderId && config.gitInstallationId && config.repoFullName) {
    const teamId = await resolveProviderCheckoutTeamId(config);
    const [provider] = await db
      .select()
      .from(gitProviders)
      .where(and(eq(gitProviders.id, config.gitProviderId), eq(gitProviders.teamId, teamId)))
      .limit(1);

    if (!provider) {
      throw new Error(`Git provider ${config.gitProviderId} not found.`);
    }
    if (provider.type === "github") return resolveGitHubCheckoutSpec(config, teamId);
    if (provider.type === "gitlab") return resolveGitLabCheckoutSpec(config, teamId);
    if (provider.type === "bitbucket" || provider.type === "gitea") {
      return resolveGenericOAuthCheckoutSpec(config, provider.type, teamId);
    }
    throw new Error(`Unsupported git provider type: ${provider.type}`);
  }

  if (!config.repoUrl) return null;

  const credential = await resolveActiveProjectRepositoryCredential(config.projectId);
  const credentialCheckout =
    credential?.kind === "https_token"
      ? {
          gitConfig: [
            authorizationHeader(
              credential.username
                ? `Authorization: Basic ${toBase64(`${credential.username}:${credential.token}`)}`
                : `Authorization: Bearer ${credential.token}`
            )
          ],
          sshPrivateKey: undefined
        }
      : credential?.kind === "https_basic"
        ? {
            gitConfig: [
              authorizationHeader(
                `Authorization: Basic ${toBase64(`${credential.username}:${credential.password}`)}`
              )
            ],
            sshPrivateKey: undefined
          }
        : credential?.kind === "ssh_key"
          ? { gitConfig: [], sshPrivateKey: credential.privateKey }
          : { gitConfig: [], sshPrivateKey: undefined };

  return {
    repoUrl: config.repoUrl,
    branch: config.branch ?? "main",
    displayLabel: config.repoFullName ?? config.repoUrl,
    gitConfig: credentialCheckout.gitConfig,
    ...(credentialCheckout.sshPrivateKey
      ? { sshPrivateKey: credentialCheckout.sshPrivateKey }
      : {}),
    repositoryPreparation,
    requiresLocalMaterialization: hasRepositoryPreparation(repositoryPreparation)
  };
}
