export type GitLabCredentialMode = "oauth" | "api_token" | "deploy_token";

export interface GitLabProviderFormState {
  name: string;
  credentialMode: GitLabCredentialMode;
  clientId: string;
  clientSecret: string;
  apiToken: string;
  deployUsername: string;
  deployToken: string;
  expiresAt: string;
  webhookSecret: string;
  baseUrl: string;
  internalBaseUrl: string;
}

export const INITIAL_GITLAB_PROVIDER_FORM: GitLabProviderFormState = {
  name: "",
  credentialMode: "oauth",
  clientId: "",
  clientSecret: "",
  apiToken: "",
  deployUsername: "",
  deployToken: "",
  expiresAt: "",
  webhookSecret: "",
  baseUrl: "",
  internalBaseUrl: ""
};

interface GitLabOAuthCredentialInput {
  kind: "oauth";
}

interface GitLabApiTokenCredentialInput {
  kind: "api_token";
  token: string;
  expiresAt?: string;
}

interface GitLabDeployTokenCredentialInput {
  kind: "deploy_token";
  username: string;
  token: string;
  expiresAt?: string;
}

export type GitLabCredentialInput =
  GitLabOAuthCredentialInput | GitLabApiTokenCredentialInput | GitLabDeployTokenCredentialInput;

export interface GitLabProviderRegistrationPayload {
  type: "gitlab";
  name: string;
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
  baseUrl?: string;
  internalBaseUrl?: string;
  gitlabCredential: GitLabCredentialInput;
}

export function isGitLabCredentialMode(value: string): value is GitLabCredentialMode {
  return value === "oauth" || value === "api_token" || value === "deploy_token";
}

export function normalizeGitLabExpiry(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isGitLabProviderFormValid(form: GitLabProviderFormState): boolean {
  if (!form.name.trim() || (form.expiresAt.trim() && !normalizeGitLabExpiry(form.expiresAt))) {
    return false;
  }

  if (form.credentialMode === "oauth") {
    return Boolean(form.clientId.trim()) && Boolean(form.clientSecret.trim());
  }

  if (form.credentialMode === "api_token") {
    return Boolean(form.apiToken.trim());
  }

  return Boolean(form.deployUsername.trim()) && Boolean(form.deployToken.trim());
}

export function buildGitLabProviderPayload(
  form: GitLabProviderFormState
): GitLabProviderRegistrationPayload | null {
  if (!isGitLabProviderFormValid(form)) return null;

  const expiresAt = normalizeGitLabExpiry(form.expiresAt);
  const common = {
    type: "gitlab" as const,
    name: form.name.trim(),
    clientId: form.credentialMode === "oauth" ? form.clientId.trim() || undefined : undefined,
    clientSecret:
      form.credentialMode === "oauth" ? form.clientSecret.trim() || undefined : undefined,
    webhookSecret: form.webhookSecret.trim() || undefined,
    baseUrl: form.baseUrl.trim() || undefined,
    internalBaseUrl: form.internalBaseUrl.trim() || undefined
  };

  if (form.credentialMode === "oauth") {
    return { ...common, gitlabCredential: { kind: "oauth" } };
  }

  if (form.credentialMode === "api_token") {
    return {
      ...common,
      gitlabCredential: {
        kind: "api_token",
        token: form.apiToken.trim(),
        ...(expiresAt ? { expiresAt } : {})
      }
    };
  }

  return {
    ...common,
    gitlabCredential: {
      kind: "deploy_token",
      username: form.deployUsername.trim(),
      token: form.deployToken.trim(),
      ...(expiresAt ? { expiresAt } : {})
    }
  };
}
