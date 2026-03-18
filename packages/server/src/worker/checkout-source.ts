import { createSign } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { gitProviders } from "../db/schema/git-providers";
import { getGitInstallation, readGitInstallationAccessToken } from "../db/services/git-providers";
import { decrypt } from "../db/crypto";
import type { ConfigSnapshot } from "./step-management";
import {
  hasRepositoryPreparation,
  readRepositoryPreparationConfig,
  type RepositoryPreparationConfig
} from "../repository-preparation";

type GitConfigEntry = {
  key: string;
  value: string;
};

export interface CheckoutSpec {
  repoUrl: string;
  branch: string;
  displayLabel: string;
  gitConfig: GitConfigEntry[];
  repositoryPreparation: RepositoryPreparationConfig;
  requiresLocalMaterialization: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function toBase64Url(value: string): string {
  return toBase64(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function buildGitHubApiBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    return "https://api.github.com";
  }

  const normalized = trimTrailingSlash(baseUrl);
  return normalized.includes("/api/") ? normalized : `${normalized}/api/v3`;
}

function buildGitHubRepoUrl(baseUrl: string | null, repoFullName: string): string {
  const normalized = trimTrailingSlash(baseUrl ?? "https://github.com");
  return `${normalized}/${repoFullName}.git`;
}

function buildGitLabRepoUrl(baseUrl: string | null, repoFullName: string): string {
  const normalized = trimTrailingSlash(baseUrl ?? "https://gitlab.com");
  return `${normalized}/${repoFullName}.git`;
}

function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 600,
      iss: appId
    })
  );

  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer
    .sign(privateKeyPem, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${payload}.${signature}`;
}

async function resolveGitHubCheckoutSpec(config: ConfigSnapshot): Promise<CheckoutSpec> {
  const providerId = config.gitProviderId;
  const installationId = config.gitInstallationId;
  const repoFullName = config.repoFullName;
  if (!providerId || !installationId || !repoFullName) {
    throw new Error("GitHub source is missing provider, installation, or repository metadata.");
  }

  const [provider, installation] = await Promise.all([
    db.select().from(gitProviders).where(eq(gitProviders.id, providerId)).limit(1),
    getGitInstallation(installationId)
  ]);

  if (!provider[0]) {
    throw new Error(`Git provider ${providerId} not found.`);
  }
  if (provider[0].type !== "github") {
    throw new Error(`Git provider ${providerId} is not a GitHub provider.`);
  }
  if (!installation || installation.providerId !== providerId) {
    throw new Error(`Git installation ${installationId} not found for provider ${providerId}.`);
  }
  if (!provider[0].appId || !provider[0].privateKeyEncrypted) {
    throw new Error(`GitHub provider ${provider[0].name} is missing app credentials.`);
  }

  const jwt = createGitHubAppJwt(provider[0].appId, decrypt(provider[0].privateKeyEncrypted));
  const response = await fetch(
    `${buildGitHubApiBaseUrl(provider[0].baseUrl)}/app/installations/${installation.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "DaoFlow"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub installation token exchange failed with status ${response.status}.`);
  }

  const tokenData = (await response.json()) as { token?: string };
  if (!tokenData.token) {
    throw new Error("GitHub installation token exchange did not return a token.");
  }

  const repositoryPreparation = readRepositoryPreparationConfig(config.repositoryPreparation);

  return {
    repoUrl: buildGitHubRepoUrl(provider[0].baseUrl, repoFullName),
    branch: config.branch ?? "main",
    displayLabel: repoFullName,
    gitConfig: [
      {
        key: "http.extraHeader",
        value: `AUTHORIZATION: basic ${toBase64(`x-access-token:${tokenData.token}`)}`
      }
    ],
    repositoryPreparation,
    requiresLocalMaterialization: true
  };
}

async function resolveGitLabCheckoutSpec(config: ConfigSnapshot): Promise<CheckoutSpec> {
  const providerId = config.gitProviderId;
  const installationId = config.gitInstallationId;
  const repoFullName = config.repoFullName;
  if (!providerId || !installationId || !repoFullName) {
    throw new Error("GitLab source is missing provider, installation, or repository metadata.");
  }

  const [provider, installation] = await Promise.all([
    db.select().from(gitProviders).where(eq(gitProviders.id, providerId)).limit(1),
    getGitInstallation(installationId)
  ]);

  if (!provider[0]) {
    throw new Error(`Git provider ${providerId} not found.`);
  }
  if (provider[0].type !== "gitlab") {
    throw new Error(`Git provider ${providerId} is not a GitLab provider.`);
  }
  if (!installation || installation.providerId !== providerId) {
    throw new Error(`Git installation ${installationId} not found for provider ${providerId}.`);
  }

  const accessToken = readGitInstallationAccessToken(installation);
  if (!accessToken) {
    throw new Error(`GitLab installation ${installationId} does not have a usable access token.`);
  }

  const repositoryPreparation = readRepositoryPreparationConfig(config.repositoryPreparation);

  return {
    repoUrl: buildGitLabRepoUrl(provider[0].baseUrl, repoFullName),
    branch: config.branch ?? "main",
    displayLabel: repoFullName,
    gitConfig: [
      {
        key: "http.extraHeader",
        value: `Authorization: Bearer ${accessToken}`
      }
    ],
    repositoryPreparation,
    requiresLocalMaterialization: true
  };
}

export async function resolveCheckoutSpec(config: ConfigSnapshot): Promise<CheckoutSpec | null> {
  const repositoryPreparation = readRepositoryPreparationConfig(config.repositoryPreparation);

  if (config.gitProviderId && config.gitInstallationId && config.repoFullName) {
    const [provider] = await db
      .select()
      .from(gitProviders)
      .where(eq(gitProviders.id, config.gitProviderId))
      .limit(1);

    if (!provider) {
      throw new Error(`Git provider ${config.gitProviderId} not found.`);
    }

    if (provider.type === "github") {
      return resolveGitHubCheckoutSpec(config);
    }

    if (provider.type === "gitlab") {
      return resolveGitLabCheckoutSpec(config);
    }

    throw new Error(`Unsupported git provider type: ${provider.type}`);
  }

  if (!config.repoUrl) {
    return null;
  }

  return {
    repoUrl: config.repoUrl,
    branch: config.branch ?? "main",
    displayLabel: config.repoFullName ?? config.repoUrl,
    gitConfig: [],
    repositoryPreparation,
    requiresLocalMaterialization: hasRepositoryPreparation(repositoryPreparation)
  };
}
