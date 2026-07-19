import { decrypt, encrypt, getEncryptionKeyId } from "../crypto";
import type { gitInstallations } from "../schema/git-providers";

export const GITLAB_CREDENTIAL_ENVELOPE_VERSION = 1;

export type GitLabCredentialKind = "oauth" | "api_token" | "deploy_token";

export type GitLabCredentialInput =
  | {
      kind: "oauth";
      accessToken: string;
      refreshToken?: string;
      tokenType?: string;
      expiresAt?: string;
    }
  | { kind: "api_token"; token: string; expiresAt?: string }
  | { kind: "deploy_token"; username: string; token: string; expiresAt?: string };

export type ResolvedGitLabCredential =
  | {
      kind: "oauth";
      accessToken: string;
      refreshToken: string | null;
      tokenType: string;
      expiresAt: string | null;
      scopes: string[];
    }
  | { kind: "api_token"; token: string; expiresAt: string | null; scopes: string[] }
  | {
      kind: "deploy_token";
      username: string;
      token: string;
      expiresAt: string | null;
      scopes: string[];
    };

type StoredGitLabCredentialEnvelope =
  | {
      version: number;
      kind: "oauth";
      accessToken: string;
      refreshToken?: string;
      tokenType?: string;
    }
  | { version: number; kind: "api_token"; token: string }
  | { version: number; kind: "deploy_token"; username: string; token: string };

export interface GitLabCredentialStorage {
  credentialKind: GitLabCredentialKind;
  credentialScopes: string;
  credentialExpiresAt: Date | null;
  credentialEncrypted: string;
  credentialEnvelopeVersion: number;
  credentialKeyId: string;
}

export interface GitLabCredentialCapabilities {
  clone: boolean;
  api: boolean;
  feedback: boolean;
}

function defaultScopes(kind: GitLabCredentialKind): string[] {
  return kind === "deploy_token" ? ["read_repository"] : ["api", "read_repository"];
}

function parseExpiry(expiresAt?: string): Date | null {
  if (!expiresAt) return null;
  const parsed = new Date(expiresAt);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("GitLab credential expiry must be a valid ISO timestamp.");
  }
  return parsed;
}

export function readGitLabCredentialScopes(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function readExpiry(value: Date | null): string | null {
  return value && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

export function getGitLabCredentialCapabilities(
  kind: GitLabCredentialKind | null
): GitLabCredentialCapabilities {
  return kind === "deploy_token"
    ? { clone: true, api: false, feedback: false }
    : { clone: true, api: true, feedback: true };
}

export function createGitLabCredentialStorage(
  input: GitLabCredentialInput
): GitLabCredentialStorage {
  const envelope: StoredGitLabCredentialEnvelope =
    input.kind === "oauth"
      ? {
          version: GITLAB_CREDENTIAL_ENVELOPE_VERSION,
          kind: "oauth",
          accessToken: input.accessToken,
          ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
          tokenType: input.tokenType ?? "Bearer"
        }
      : input.kind === "api_token"
        ? {
            version: GITLAB_CREDENTIAL_ENVELOPE_VERSION,
            kind: "api_token",
            token: input.token
          }
        : {
            version: GITLAB_CREDENTIAL_ENVELOPE_VERSION,
            kind: "deploy_token",
            username: input.username,
            token: input.token
          };

  return {
    credentialKind: input.kind,
    credentialScopes: JSON.stringify(defaultScopes(input.kind)),
    credentialExpiresAt: parseExpiry(input.expiresAt),
    credentialEncrypted: encrypt(JSON.stringify(envelope)),
    credentialEnvelopeVersion: GITLAB_CREDENTIAL_ENVELOPE_VERSION,
    credentialKeyId: getEncryptionKeyId()
  };
}

export function readGitLabCredential(
  installation: Pick<
    typeof gitInstallations.$inferSelect,
    | "credentialKind"
    | "credentialScopes"
    | "credentialExpiresAt"
    | "credentialEncrypted"
    | "credentialEnvelopeVersion"
  >
): ResolvedGitLabCredential | null {
  if (
    !installation.credentialKind ||
    !installation.credentialEncrypted ||
    installation.credentialEnvelopeVersion !== GITLAB_CREDENTIAL_ENVELOPE_VERSION
  ) {
    return null;
  }

  try {
    const envelope = JSON.parse(
      decrypt(installation.credentialEncrypted)
    ) as StoredGitLabCredentialEnvelope;
    if (
      envelope.version !== GITLAB_CREDENTIAL_ENVELOPE_VERSION ||
      envelope.kind !== installation.credentialKind
    ) {
      return null;
    }

    const scopes = readGitLabCredentialScopes(installation.credentialScopes);
    const expiresAt = readExpiry(installation.credentialExpiresAt);
    if (envelope.kind === "oauth" && typeof envelope.accessToken === "string") {
      return {
        kind: "oauth",
        accessToken: envelope.accessToken,
        refreshToken: envelope.refreshToken ?? null,
        tokenType: envelope.tokenType ?? "Bearer",
        expiresAt,
        scopes: scopes.length > 0 ? scopes : defaultScopes("oauth")
      };
    }
    if (envelope.kind === "api_token" && typeof envelope.token === "string") {
      return {
        kind: "api_token",
        token: envelope.token,
        expiresAt,
        scopes: scopes.length > 0 ? scopes : defaultScopes("api_token")
      };
    }
    if (
      envelope.kind === "deploy_token" &&
      typeof envelope.username === "string" &&
      typeof envelope.token === "string"
    ) {
      return {
        kind: "deploy_token",
        username: envelope.username,
        token: envelope.token,
        expiresAt,
        scopes: scopes.length > 0 ? scopes : defaultScopes("deploy_token")
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function getGitLabCredentialKind(
  installation: Pick<
    typeof gitInstallations.$inferSelect,
    "credentialKind" | "credentialEncrypted" | "credentialEnvelopeVersion"
  >
): GitLabCredentialKind | null {
  const credential = readGitLabCredential({
    ...installation,
    credentialScopes: null,
    credentialExpiresAt: null
  });
  return credential?.kind ?? null;
}
