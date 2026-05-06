import { createSign } from "node:crypto";
import { decrypt } from "../crypto";
import { buildGitHubApiBaseUrl } from "./project-source-provider-validation-shared";
import type { gitInstallations, gitProviders } from "../schema/git-providers";

type GitHubProviderRecord = Pick<
  typeof gitProviders.$inferSelect,
  "name" | "appId" | "privateKeyEncrypted" | "baseUrl"
>;

type GitHubInstallationRecord = Pick<typeof gitInstallations.$inferSelect, "installationId">;

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

export async function fetchGitHubInstallationAccessToken(input: {
  provider: GitHubProviderRecord;
  installation: GitHubInstallationRecord;
}) {
  if (!input.provider.appId || !input.provider.privateKeyEncrypted) {
    throw new Error(`GitHub provider ${input.provider.name} is missing app credentials.`);
  }

  const jwt = createGitHubAppJwt(input.provider.appId, decrypt(input.provider.privateKeyEncrypted));
  const response = await fetch(
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
