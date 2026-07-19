import { createSign } from "node:crypto";
import { decrypt } from "../crypto";
import { fetchWithGitProviderCa } from "./git-provider-ca-trust";
import { buildGitHubApiBaseUrl } from "./project-source-provider-validation-shared";
import type { gitInstallations, gitProviders } from "../schema/git-providers";

type GitHubProviderRecord = Pick<
  typeof gitProviders.$inferSelect,
  | "name"
  | "teamId"
  | "caCertificateId"
  | "appId"
  | "clientId"
  | "clientSecretEncrypted"
  | "privateKeyEncrypted"
  | "baseUrl"
>;

type GitHubInstallationRecord = Pick<typeof gitInstallations.$inferSelect, "installationId">;

export interface GitHubInstallationDetails {
  accountName: string;
  accountType: string;
  repositorySelection: string;
}

export function buildGitHubWebBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) return "https://github.com";
  const parsed = new URL(baseUrl);
  if (parsed.hostname === "api.github.com") return "https://github.com";
  return parsed.origin;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
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
  const signature = signer.sign(privateKeyPem).toString("base64url");

  return `${header}.${payload}.${signature}`;
}

function createProviderJwt(provider: GitHubProviderRecord): string {
  if (!provider.appId || !provider.privateKeyEncrypted) {
    throw new Error(`GitHub provider ${provider.name} is missing app credentials.`);
  }
  return createGitHubAppJwt(provider.appId, decrypt(provider.privateKeyEncrypted));
}

export async function fetchGitHubAppSlug(provider: GitHubProviderRecord): Promise<string> {
  const response = await fetchWithGitProviderCa(
    provider,
    `${buildGitHubApiBaseUrl(provider.baseUrl)}/app`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${createProviderJwt(provider)}`,
        "User-Agent": "DaoFlow"
      }
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub App lookup failed with status ${response.status}.`);
  }

  const app = (await response.json()) as { slug?: string };
  if (!app.slug) {
    throw new Error("GitHub App lookup did not return an app slug.");
  }
  return app.slug;
}

async function exchangeGitHubUserAccessToken(input: {
  provider: GitHubProviderRecord;
  code: string;
}): Promise<string> {
  if (!input.provider.clientId || !input.provider.clientSecretEncrypted) {
    throw new Error(`GitHub provider ${input.provider.name} is missing OAuth credentials.`);
  }

  const response = await fetchWithGitProviderCa(
    input.provider,
    `${buildGitHubWebBaseUrl(input.provider.baseUrl)}/login/oauth/access_token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "DaoFlow"
      },
      body: new URLSearchParams({
        client_id: input.provider.clientId,
        client_secret: decrypt(input.provider.clientSecretEncrypted),
        code: input.code
      }).toString()
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub user token exchange failed with status ${response.status}.`);
  }

  const token = (await response.json()) as { access_token?: string };
  if (!token.access_token) {
    throw new Error("GitHub user token exchange did not return an access token.");
  }
  return token.access_token;
}

export async function verifyGitHubInstallationForUser(input: {
  provider: GitHubProviderRecord;
  installationId: string;
  code: string;
}): Promise<void> {
  const userAccessToken = await exchangeGitHubUserAccessToken({
    provider: input.provider,
    code: input.code
  });
  const response = await fetchWithGitProviderCa(
    input.provider,
    `${buildGitHubApiBaseUrl(input.provider.baseUrl)}/user/installations/${encodeURIComponent(input.installationId)}/repositories?per_page=1`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${userAccessToken}`,
        "User-Agent": "DaoFlow"
      }
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub user cannot access installation ${input.installationId}.`);
  }
}

export async function fetchGitHubInstallationAccessToken(input: {
  provider: GitHubProviderRecord;
  installation: GitHubInstallationRecord;
}) {
  const jwt = createProviderJwt(input.provider);
  const response = await fetchWithGitProviderCa(
    input.provider,
    `${buildGitHubApiBaseUrl(input.provider.baseUrl)}/app/installations/${input.installation.installationId}/access_tokens`,
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

  return tokenData.token;
}

export async function fetchGitHubInstallationDetails(input: {
  provider: GitHubProviderRecord;
  installationId: string;
}): Promise<GitHubInstallationDetails> {
  const jwt = createProviderJwt(input.provider);
  const response = await fetchWithGitProviderCa(
    input.provider,
    `${buildGitHubApiBaseUrl(input.provider.baseUrl)}/app/installations/${encodeURIComponent(input.installationId)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "DaoFlow"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub installation lookup failed with status ${response.status}.`);
  }

  const installation = (await response.json()) as {
    account?: { login?: string; type?: string };
    repository_selection?: string;
  };
  if (!installation.account?.login) {
    throw new Error("GitHub installation lookup did not return an owner account.");
  }

  return {
    accountName: installation.account.login,
    accountType: installation.account.type ?? "organization",
    repositorySelection: installation.repository_selection ?? "all"
  };
}
