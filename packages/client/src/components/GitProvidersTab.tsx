import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Plus, Trash2, ExternalLink, Github } from "lucide-react";
import { getInventoryBadgeVariant } from "../lib/tone-utils";
import {
  normalizeGitHubAppNameSegment,
  trimTrailingSlash
} from "./git-providers/git-provider-utils";
import { GitHubProviderDialog } from "./git-providers/GitHubProviderDialog";
import { GitLabProviderDialog } from "./git-providers/GitLabProviderDialog";

export default function GitProvidersTab() {
  const [showGitHubDialog, setShowGitHubDialog] = useState(false);
  const [showGitLabDialog, setShowGitLabDialog] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const providers = trpc.gitProviders.useQuery();

  const gitSetup = searchParams.get("git_setup");
  const gitError = searchParams.get("git_error");

  useEffect(() => {
    if (gitSetup || gitError) {
      void providers.refetch();
      const timeout = setTimeout(() => {
        setSearchParams((prev) => {
          prev.delete("git_setup");
          prev.delete("git_error");
          prev.delete("provider_id");
          return prev;
        });
      }, 5000);
      return () => clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitSetup, gitError]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Git Providers</h3>
          <p className="text-sm text-muted-foreground">
            Connect GitHub or GitLab Apps for source code integration.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => setShowGitHubDialog(true)}
            data-testid="git-provider-add-github"
          >
            <Github size={14} className="mr-1" /> GitHub
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowGitLabDialog(true)}
            data-testid="git-provider-add-gitlab"
          >
            <Plus size={14} className="mr-1" /> GitLab
          </Button>
        </div>
      </div>

      {(gitSetup || gitError) && (
        <Card>
          <CardContent className="py-3">
            {gitSetup === "created" && (
              <p className="text-sm text-green-600">
                GitHub App created successfully. Install it on your account or organization to
                complete setup.
              </p>
            )}
            {gitSetup === "installed" && (
              <p className="text-sm text-green-600">
                GitHub App installed successfully. You can now link repositories to your projects.
              </p>
            )}
            {gitError && (
              <p className="text-sm text-destructive">
                GitHub App setup failed: {gitError.replace(/_/g, " ")}. Please try again.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {providers.data?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <GitBranch size={32} className="mx-auto mb-3 opacity-40" />
            <p>No git providers configured.</p>
            <p className="text-xs mt-1">
              Add a GitHub App or GitLab OAuth app to enable source-code integration.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {providers.data?.map((p) => (
            <ProviderCard key={p.id} provider={p} onDeleted={() => void providers.refetch()} />
          ))}
        </div>
      )}

      <GitHubProviderDialog
        open={showGitHubDialog}
        onOpenChange={setShowGitHubDialog}
        onRegistered={() => void providers.refetch()}
      />
      <GitLabProviderDialog
        open={showGitLabDialog}
        onOpenChange={setShowGitLabDialog}
        onRegistered={() => void providers.refetch()}
      />
    </div>
  );
}

function ProviderCard({
  provider,
  onDeleted
}: {
  provider: {
    id: string;
    type: string;
    name: string;
    status: string;
    appId: string | null;
    clientId: string | null;
    baseUrl: string | null;
  };
  onDeleted: () => void;
}) {
  const deleteMutation = trpc.deleteGitProvider.useMutation({
    onSuccess: onDeleted
  });
  const githubInstallPath = normalizeGitHubAppNameSegment(provider.name);
  const canRenderGitHubInstallLink =
    provider.type === "github" && Boolean(provider.appId) && githubInstallPath.length > 0;
  const gitlabBaseUrl = trimTrailingSlash(provider.baseUrl || "https://gitlab.com");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch size={16} />
            {provider.name}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{provider.type}</Badge>
            <Badge variant={getInventoryBadgeVariant(provider.status)}>{provider.status}</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteMutation.mutate({ providerId: provider.id })}
              disabled={deleteMutation.isPending}
              data-testid={`git-provider-delete-${provider.id}`}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {provider.type === "github"
            ? `App ID: ${provider.appId ?? "—"}`
            : `Client ID: ${provider.clientId ?? "—"}`}
          {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
        </p>
        {canRenderGitHubInstallLink ? (
          <a
            href={`https://github.com/apps/${githubInstallPath}/installations/new?state=gh_setup:${provider.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm" data-testid={`git-provider-install-${provider.id}`}>
              <ExternalLink size={12} className="mr-1" /> Install on GitHub
            </Button>
          </a>
        ) : provider.type === "gitlab" && provider.clientId ? (
          <a
            href={`${gitlabBaseUrl}/oauth/authorize?client_id=${provider.clientId}&redirect_uri=${encodeURIComponent(window.location.origin + "/settings/git/callback")}&response_type=code&state=${provider.id}&scope=api`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm" data-testid={`git-provider-connect-${provider.id}`}>
              <ExternalLink size={12} className="mr-1" /> Connect GitLab
            </Button>
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}
