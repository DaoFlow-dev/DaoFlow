import type { gitInstallations, gitProviders } from "../schema/git-providers";
import {
  getGitLabCredentialCapabilities,
  readGitLabCredential,
  type GitLabCredentialCapabilities,
  type GitLabCredentialKind
} from "./gitlab-credentials";
import { readLegacyGitInstallationOAuthCredentials } from "./git-installation-legacy-credentials";

export interface GitProviderSummary {
  id: string;
  type: string;
  name: string;
  status: string;
  appId: string | null;
  clientId: string | null;
  baseUrl: string | null;
  internalBaseUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GitInstallationSummary {
  id: string;
  providerId: string;
  installationId: string;
  accountName: string;
  accountType: string;
  repositorySelection: string;
  status: string;
  installedByUserId: string | null;
  credentialKind: GitLabCredentialKind | null;
  credentialScopes: string[];
  credentialExpiresAt: Date | null;
  capabilities: GitLabCredentialCapabilities;
  createdAt: Date;
  updatedAt: Date;
}

export function toGitProviderSummary(row: typeof gitProviders.$inferSelect): GitProviderSummary {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    appId: row.appId,
    clientId: row.clientId,
    baseUrl: row.baseUrl,
    internalBaseUrl: row.internalBaseUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function toGitInstallationSummary(
  row: typeof gitInstallations.$inferSelect
): GitInstallationSummary {
  const credential = readGitLabCredential(row);
  const legacyCredential = credential ? null : readLegacyGitInstallationOAuthCredentials(row);
  const kind = credential?.kind ?? (legacyCredential ? "oauth" : null);
  const expiresAt = credential?.expiresAt ?? legacyCredential?.expiresAt ?? null;
  const credentialExpiresAt = expiresAt ? new Date(expiresAt) : null;

  return {
    id: row.id,
    providerId: row.providerId,
    installationId: row.installationId,
    accountName: row.accountName,
    accountType: row.accountType,
    repositorySelection: row.repositorySelection,
    status: row.status,
    installedByUserId: row.installedByUserId,
    credentialKind: kind,
    credentialScopes: credential?.scopes ?? (legacyCredential ? ["api", "read_repository"] : []),
    credentialExpiresAt:
      credentialExpiresAt && Number.isFinite(credentialExpiresAt.getTime())
        ? credentialExpiresAt
        : null,
    capabilities: getGitLabCredentialCapabilities(kind),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
