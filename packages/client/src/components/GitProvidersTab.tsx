import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Plus, Github, Webhook } from "lucide-react";
import { getInventoryBadgeVariant } from "../lib/tone-utils";
import { GitHubProviderDialog } from "./git-providers/GitHubProviderDialog";
import { GitProviderCard } from "./git-providers/GitProviderCard";
import { GitLabProviderDialog } from "./git-providers/GitLabProviderDialog";

export default function GitProvidersTab() {
  const [showGitHubDialog, setShowGitHubDialog] = useState(false);
  const [showGitLabDialog, setShowGitLabDialog] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const session = useSession();
  const providers = trpc.gitProviders.useQuery(undefined, { enabled: Boolean(session.data) });
  const installations = trpc.gitInstallations.useQuery({}, { enabled: Boolean(session.data) });
  const webhookDeliveries = trpc.webhookDeliveries.useQuery(
    { limit: 20 },
    { enabled: Boolean(session.data) }
  );

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
              Add a GitHub App or a GitLab credential to enable source-code integration.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {providers.data?.map((p) => (
            <GitProviderCard
              key={p.id}
              provider={p}
              installations={installations.data ?? []}
              onDeleted={() => {
                void providers.refetch();
                void installations.refetch();
              }}
            />
          ))}
        </div>
      )}

      <WebhookDeliveryHistory deliveries={webhookDeliveries.data ?? []} />

      <GitHubProviderDialog
        open={showGitHubDialog}
        onOpenChange={setShowGitHubDialog}
        onRegistered={() => {
          void providers.refetch();
          void installations.refetch();
        }}
      />
      <GitLabProviderDialog
        open={showGitLabDialog}
        onOpenChange={setShowGitLabDialog}
        onRegistered={() => {
          void providers.refetch();
          void installations.refetch();
        }}
      />
    </div>
  );
}

function WebhookDeliveryHistory({
  deliveries
}: {
  deliveries: Array<{
    id: string;
    providerType: string;
    repoFullName: string | null;
    commitSha: string | null;
    status: string;
    attemptCount: number;
    lastErrorSummary: string | null;
    lastSeenAt: Date | string;
    attempts: Array<{
      id: string;
      attemptNumber: number;
      status: string;
      errorSummary: string | null;
    }>;
    targets: Array<{
      targetKey: string;
      status: string;
      errorSummary: string | null;
    }>;
  }>;
}) {
  return (
    <Card data-testid="webhook-delivery-history">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Webhook size={16} /> Recent webhook deliveries
        </CardTitle>
      </CardHeader>
      <CardContent>
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No GitHub or GitLab webhook deliveries have reached this team yet.
          </p>
        ) : (
          <div className="divide-y">
            {deliveries.map((delivery) => (
              <div key={delivery.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {delivery.repoFullName ?? "Unknown repository"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {delivery.providerType} · {delivery.commitSha?.slice(0, 7) || "no commit"} ·{" "}
                      {new Date(delivery.lastSeenAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{delivery.attemptCount} attempt(s)</Badge>
                    <Badge variant={getInventoryBadgeVariant(delivery.status)}>
                      {delivery.status}
                    </Badge>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {delivery.attempts.map((attempt) => (
                    <Badge
                      key={attempt.id}
                      variant={getInventoryBadgeVariant(attempt.status)}
                      title={attempt.errorSummary ?? undefined}
                    >
                      attempt #{attempt.attemptNumber} · {attempt.status}
                    </Badge>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {delivery.targets.map((target) => (
                    <Badge
                      key={target.targetKey}
                      variant={getInventoryBadgeVariant(target.status)}
                      title={target.errorSummary ?? undefined}
                    >
                      {target.targetKey.replace(/^(project|service):/, "")} · {target.status}
                    </Badge>
                  ))}
                </div>
                {delivery.lastErrorSummary ? (
                  <p className="mt-2 text-xs text-destructive">{delivery.lastErrorSummary}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
