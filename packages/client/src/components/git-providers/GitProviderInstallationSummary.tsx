import { Badge } from "@/components/ui/badge";

export type GitProviderCredentialKind = "oauth" | "api_token" | "deploy_token" | "legacy_oauth";

export interface GitProviderInstallationSummaryData {
  id: string;
  providerId: string;
  accountName: string;
  credentialKind?: GitProviderCredentialKind | null;
  credentialScopes?: string[] | null;
  credentialExpiresAt?: Date | string | null;
  capabilities?: {
    clone?: boolean;
    api?: boolean;
    feedback?: boolean;
  } | null;
}

interface GitProviderCapabilities {
  clone: boolean;
  api: boolean;
  feedback: boolean;
}

function credentialModeLabel(
  credentialKind: GitProviderCredentialKind | null | undefined,
  providerType: string
) {
  if (credentialKind === "deploy_token") return "Deploy token";
  if (credentialKind === "api_token") return "API token";
  if (credentialKind === "oauth") return "OAuth";
  return providerType === "github" ? "GitHub App" : "OAuth";
}

function defaultCapabilities(
  credentialKind: GitProviderCredentialKind | null | undefined
): GitProviderCapabilities {
  if (credentialKind === "deploy_token") {
    return { clone: true, api: false, feedback: false };
  }
  return { clone: true, api: true, feedback: true };
}

function getCapabilities(
  installation: GitProviderInstallationSummaryData
): GitProviderCapabilities {
  const fallback = defaultCapabilities(installation.credentialKind);
  return {
    clone: installation.capabilities?.clone ?? fallback.clone,
    api: installation.capabilities?.api ?? fallback.api,
    feedback: installation.capabilities?.feedback ?? fallback.feedback
  };
}

function formatExpiry(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

export function GitProviderInstallationSummary({
  providerType,
  installation
}: {
  providerType: string;
  installation: GitProviderInstallationSummaryData;
}) {
  const capabilities = getCapabilities(installation);
  const mode = credentialModeLabel(installation.credentialKind, providerType);
  const expiry = formatExpiry(installation.credentialExpiresAt);
  const scopeLabel = installation.credentialScopes?.length
    ? installation.credentialScopes.join(", ")
    : null;

  return (
    <div
      className="rounded-md border border-border/70 bg-muted/20 p-3"
      data-testid={`git-provider-installation-${installation.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            className="truncate text-sm font-medium"
            data-testid={`git-provider-installation-account-${installation.id}`}
          >
            {installation.accountName}
          </p>
          <p
            className="text-xs text-muted-foreground"
            data-testid={`git-provider-credential-${installation.id}`}
          >
            Credential: {mode}
            {expiry ? ` · Expires ${expiry}` : ""}
          </p>
        </div>
        {installation.credentialKind === "deploy_token" ? (
          <Badge variant="outline" data-testid={`git-provider-clone-only-${installation.id}`}>
            Clone only
          </Badge>
        ) : null}
      </div>
      {scopeLabel ? (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`git-provider-scopes-${installation.id}`}
        >
          Scopes: {scopeLabel}
        </p>
      ) : null}
      <div
        className="mt-2 flex flex-wrap gap-1.5"
        data-testid={`git-provider-capabilities-${installation.id}`}
      >
        {(
          [
            ["clone", "Clone", capabilities.clone],
            ["api", "API", capabilities.api],
            ["feedback", "Feedback", capabilities.feedback]
          ] satisfies Array<[string, string, boolean]>
        ).map(([key, label, enabled]) => (
          <Badge
            key={key}
            variant={enabled ? "secondary" : "outline"}
            data-testid={`git-provider-capability-${installation.id}-${key}`}
          >
            {label}: {enabled ? "Yes" : "No"}
          </Badge>
        ))}
      </div>
      {installation.credentialKind === "deploy_token" ? (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`git-provider-deploy-limitation-${installation.id}`}
        >
          Deploy tokens can clone repositories only; GitLab API and feedback are unavailable.
        </p>
      ) : null}
    </div>
  );
}
