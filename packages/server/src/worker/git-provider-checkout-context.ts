import type { gitProviders } from "../db/schema/git-providers";
import { resolveGitProviderCaForProvider } from "../db/services/git-provider-ca-trust";
import { resolveGitLabCloneBaseUrl } from "../db/services/gitlab-urls";
import { validateGitProviderCaRepositoryUrl } from "./git-ca-file";

export type GitConfigEntry = {
  key: string;
  value: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export function authorizationHeader(value: string): GitConfigEntry {
  return { key: "http.extraHeader", value };
}

export function buildGitHubRepoUrl(baseUrl: string | null, repoFullName: string): string {
  return `${trimTrailingSlash(baseUrl ?? "https://github.com")}/${repoFullName}.git`;
}

export function buildGitLabRepoUrl(
  provider: Pick<typeof gitProviders.$inferSelect, "baseUrl" | "internalBaseUrl">,
  repoFullName: string
): string {
  return `${trimTrailingSlash(resolveGitLabCloneBaseUrl(provider))}/${repoFullName}.git`;
}

export async function resolveProviderCaCheckoutContext(
  provider: Pick<typeof gitProviders.$inferSelect, "teamId" | "caCertificateId">,
  repoUrl: string
): Promise<{ caCertificatePem?: string }> {
  const ca = await resolveGitProviderCaForProvider({
    teamId: provider.teamId,
    caCertificateId: provider.caCertificateId
  });
  const caCertificatePem = ca?.pem;
  validateGitProviderCaRepositoryUrl(repoUrl, caCertificatePem);
  return caCertificatePem ? { caCertificatePem } : {};
}
