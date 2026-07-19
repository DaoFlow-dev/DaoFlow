import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, GitBranch, Trash2 } from "lucide-react";
import { getInventoryBadgeVariant } from "../../lib/tone-utils";
import {
  GitProviderCertificateDetails,
  GitProviderCertificateSelect
} from "./GitProviderCertificate";
import {
  getCertificateAsset,
  getGitProviderErrorMessage,
  type CertificateAssetSummary
} from "./git-provider-certificate";
import {
  GitProviderInstallationSummary,
  type GitProviderInstallationSummaryData
} from "./GitProviderInstallationSummary";
import { hasNonOAuthGitLabInstallation } from "./gitlab-provider-credentials";
import { trpc } from "../../lib/trpc";

interface GitProviderSummaryData {
  id: string;
  type: string;
  name: string;
  status: string;
  appId: string | null;
  clientId: string | null;
  baseUrl: string | null;
  internalBaseUrl?: string | null;
  caCertificateId?: string | null;
}

export function GitProviderCard({
  provider,
  installations,
  certificateAssets,
  onChanged
}: {
  provider: GitProviderSummaryData;
  installations: GitProviderInstallationSummaryData[];
  certificateAssets: CertificateAssetSummary[];
  onChanged: () => void;
}) {
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const deleteMutation = trpc.deleteGitProvider.useMutation({
    onSuccess: onChanged
  });
  const updateCaMutation = trpc.updateGitProviderCa.useMutation({
    onSuccess: () => {
      setCertificateError(null);
      onChanged();
    },
    onError: (error) =>
      setCertificateError(
        getGitProviderErrorMessage(error, "Unable to update the provider CA certificate.")
      )
  });
  const startSetup = trpc.startGitProviderSetup.useMutation({
    onSuccess: ({ authorizationUrl }) => {
      window.location.assign(authorizationUrl);
    }
  });
  const providerInstallations = installations.filter(
    (installation) => installation.providerId === provider.id
  );
  const hasNonOAuthInstallation =
    provider.type === "gitlab" && hasNonOAuthGitLabInstallation(providerInstallations);
  const canStartSetup =
    (provider.type === "github" && Boolean(provider.appId)) ||
    (provider.type === "gitlab" && Boolean(provider.clientId) && !hasNonOAuthInstallation);
  const selectedCertificate = getCertificateAsset(certificateAssets, provider.caCertificateId);

  function handleCertificateChange(caCertificateId: string | null) {
    setCertificateError(null);
    updateCaMutation.mutate({ providerId: provider.id, caCertificateId });
  }

  return (
    <Card data-testid={`git-provider-card-${provider.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch size={16} />
            <span data-testid={`git-provider-name-${provider.id}`}>{provider.name}</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" data-testid={`git-provider-type-${provider.id}`}>
              {provider.type}
            </Badge>
            <Badge
              variant={getInventoryBadgeVariant(provider.status)}
              data-testid={`git-provider-status-${provider.id}`}
            >
              {provider.status}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteMutation.mutate({ providerId: provider.id })}
              disabled={deleteMutation.isPending}
              aria-label={`Delete ${provider.name}`}
              data-testid={`git-provider-delete-${provider.id}`}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p
          className="text-xs text-muted-foreground"
          data-testid={`git-provider-credentials-${provider.id}`}
        >
          {provider.type === "github"
            ? `App ID: ${provider.appId ?? "—"}`
            : `Client ID: ${provider.clientId ?? "—"}`}
        </p>
        <div className="space-y-2" data-testid={`git-provider-ca-${provider.id}`}>
          <GitProviderCertificateSelect
            certificateAssets={certificateAssets}
            value={provider.caCertificateId ?? null}
            onChange={handleCertificateChange}
            id={`git-provider-ca-select-${provider.id}`}
            testId={`git-provider-ca-select-${provider.id}`}
            disabled={updateCaMutation.isPending}
          />
          <GitProviderCertificateDetails
            certificate={selectedCertificate}
            unavailable={Boolean(provider.caCertificateId && !selectedCertificate)}
            testId={`git-provider-ca-details-${provider.id}`}
          />
          {certificateError ? (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid={`git-provider-ca-error-${provider.id}`}
            >
              {certificateError}
            </p>
          ) : null}
        </div>
        <div
          className="space-y-1 text-xs text-muted-foreground"
          data-testid={`git-provider-routes-${provider.id}`}
        >
          <p data-testid={`git-provider-public-route-${provider.id}`}>
            Public URL:{" "}
            {provider.baseUrl ?? (provider.type === "gitlab" ? "GitLab.com" : "GitHub.com")}
          </p>
          {provider.internalBaseUrl ? (
            <p data-testid={`git-provider-internal-route-${provider.id}`}>
              Internal API/clone URL: {provider.internalBaseUrl}
            </p>
          ) : null}
        </div>
        {providerInstallations.length > 0 ? (
          <div className="space-y-2" data-testid={`git-provider-installations-${provider.id}`}>
            {providerInstallations.map((installation) => (
              <GitProviderInstallationSummary
                key={installation.id}
                providerType={provider.type}
                installation={installation}
              />
            ))}
          </div>
        ) : provider.type === "gitlab" ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid={`git-provider-no-installation-${provider.id}`}
          >
            No GitLab installation connected yet.
          </p>
        ) : null}
        {canStartSetup ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => startSetup.mutate({ providerId: provider.id })}
              disabled={startSetup.isPending}
              data-testid={
                provider.type === "github"
                  ? `git-provider-install-${provider.id}`
                  : `git-provider-connect-${provider.id}`
              }
            >
              <ExternalLink size={12} className="mr-1" />
              {provider.type === "github" ? "Install on GitHub" : "Connect GitLab"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
