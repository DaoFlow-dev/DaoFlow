import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";
import { AlertTriangle, Clock3, RefreshCw, Sparkles, Trash2 } from "lucide-react";

export interface PreviewLifecycleConfig {
  enabled: boolean;
  mode: "branch" | "pull-request" | "any";
  domainTemplate: string | null;
  staleAfterHours: number | null;
}

interface PreviewLifecyclePanelProps {
  serviceId: string;
  serviceName: string;
  previewConfig: PreviewLifecycleConfig;
  canReadPreviews: boolean;
  canManagePreviews: boolean;
}

type PreviewReconciliationRecord = {
  key: string;
  target: "branch" | "pull-request";
  branch: string;
  pullRequestNumber: number | null;
  envBranch: string;
  stackName: string;
  primaryDomain: string | null;
  latestDeploymentId: string;
  latestAction: "deploy" | "destroy";
  latestStatus: string;
  latestStatusLabel: string;
  latestStatusTone: "healthy" | "running" | "failed" | "queued";
  lastRequestedAt: string;
  lastFinishedAt: string | null;
  isActive: boolean;
  desiredDomain: string | null;
  domainStatus: "matched" | "missing" | "inactive" | "orphaned" | "cleared" | "unmanaged";
  reconciliationStatus: "in-sync" | "drifted" | "stale" | "unmanaged";
  staleAt: string | null;
  isStale: boolean;
  staleReason: string | null;
  gcEligible: boolean;
  observedRoute: {
    hostname: string;
    service: string;
    path: string | null;
    status: string;
    tunnelId: string;
    tunnelName: string;
  } | null;
};

function formatMutationError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatRelative(date: string | null): string {
  if (!date) {
    return "—";
  }

  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(Math.abs(diff) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ${diff >= 0 ? "ago" : "from now"}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${diff >= 0 ? "ago" : "from now"}`;
  return `${Math.floor(hrs / 24)}d ${diff >= 0 ? "ago" : "from now"}`;
}

function previewModeLabel(mode: PreviewLifecycleConfig["mode"]) {
  if (mode === "pull-request") {
    return "Pull requests only";
  }
  if (mode === "branch") {
    return "Branches only";
  }
  return "Branches and pull requests";
}

function previewStateLabel(preview: PreviewReconciliationRecord) {
  if (preview.gcEligible) {
    return "Cleanup due";
  }
  if (preview.reconciliationStatus === "drifted") {
    return "Needs attention";
  }
  if (preview.latestAction === "destroy") {
    return "Retired";
  }
  if (preview.isActive) {
    return "Live";
  }
  return "History only";
}

function previewReason(preview: PreviewReconciliationRecord) {
  if (preview.gcEligible && preview.staleAt) {
    return `Cleanup is due because the retention window expired at ${new Date(preview.staleAt).toLocaleString()}.`;
  }
  if (preview.domainStatus === "missing" && preview.desiredDomain) {
    return `DaoFlow expects ${preview.desiredDomain}, but no active route is attached yet.`;
  }
  if (preview.domainStatus === "inactive" && preview.desiredDomain) {
    return `${preview.desiredDomain} exists, but the observed route is not active.`;
  }
  if (preview.domainStatus === "orphaned" && preview.desiredDomain) {
    return `${preview.desiredDomain} still exists even though the latest preview action was cleanup.`;
  }
  if (preview.latestAction === "destroy") {
    return "This preview was already retired. DaoFlow keeps the history so operators can see why it existed.";
  }
  if (preview.staleAt) {
    return `If nothing newer replaces it, cleanup becomes eligible at ${new Date(preview.staleAt).toLocaleString()}.`;
  }
  if (!preview.desiredDomain) {
    return "This preview does not have a managed preview domain, so DaoFlow can only track its deployment history and manual cleanup.";
  }
  return "This preview is isolated from the base environment and still matches the managed routing state.";
}

export default function PreviewLifecyclePanel({
  serviceId,
  serviceName,
  previewConfig,
  canReadPreviews,
  canManagePreviews
}: PreviewLifecyclePanelProps) {
  const utils = trpc.useUtils();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [retiringPreviewKey, setRetiringPreviewKey] = useState<string | null>(null);
  const previewState = trpc.composePreviewReconciliation.useQuery(
    { serviceId },
    { enabled: previewConfig.enabled && canReadPreviews }
  );
  const reconcilePreviews = trpc.reconcileComposePreviews.useMutation();
  const triggerDeploy = trpc.triggerDeploy.useMutation();

  async function refreshOperationalViews() {
    await Promise.all([
      utils.composePreviewReconciliation.invalidate({ serviceId }),
      utils.composePreviews.invalidate({ serviceId }),
      utils.serviceDetails.invalidate({ serviceId })
    ]);
  }

  async function handlePreviewCleanup(dryRun: boolean) {
    setFeedback(null);
    try {
      const result = await reconcilePreviews.mutateAsync({
        serviceId,
        dryRun
      });

      const queued = result.execution.gcQueued;
      const eligible = result.execution.gcCandidates;
      setFeedback(
        dryRun
          ? `${eligible} preview ${eligible === 1 ? "environment is" : "environments are"} ready for cleanup.`
          : `Queued cleanup for ${queued} preview ${queued === 1 ? "environment" : "environments"}.`
      );
      await refreshOperationalViews();
    } catch (error) {
      setFeedback(formatMutationError(error, "Unable to evaluate preview cleanup right now."));
    }
  }

  async function handleRetirePreview(preview: PreviewReconciliationRecord) {
    setFeedback(null);
    setRetiringPreviewKey(preview.key);
    try {
      await triggerDeploy.mutateAsync({
        serviceId,
        preview: {
          target: preview.target,
          branch: preview.branch,
          pullRequestNumber: preview.pullRequestNumber ?? undefined,
          action: "destroy"
        }
      });
      setFeedback(`Queued cleanup for preview ${preview.key}.`);
      await refreshOperationalViews();
    } catch (error) {
      setFeedback(formatMutationError(error, `Unable to retire preview ${preview.key} right now.`));
    } finally {
      setRetiringPreviewKey(null);
    }
  }

  if (!canReadPreviews) {
    return (
      <Card data-testid={`service-preview-panel-access-${serviceId}`}>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Preview lifecycle needs deployment read access. Ask an operator with deployment access if
          you need preview status or cleanup details for this service.
        </CardContent>
      </Card>
    );
  }

  if (previewState.isLoading) {
    return (
      <div className="space-y-3" data-testid={`service-preview-panel-loading-${serviceId}`}>
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (previewState.error || !previewState.data) {
    return (
      <Card data-testid={`service-preview-panel-error-${serviceId}`}>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Preview lifecycle data is unavailable right now.
        </CardContent>
      </Card>
    );
  }

  const report = previewState.data;
  const previews = [...report.previews].sort((left, right) =>
    right.lastRequestedAt.localeCompare(left.lastRequestedAt)
  );

  return (
    <Card data-testid={`service-preview-panel-${serviceId}`}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles size={16} />
              Preview lifecycle
            </CardTitle>
            <CardDescription>
              Preview environments stay separate from the base environment. DaoFlow tracks when they
              were requested, whether routing still matches, and what will clean them up.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" data-testid={`service-preview-mode-${serviceId}`}>
              {previewModeLabel(previewConfig.mode)}
            </Badge>
            <Badge variant="outline" data-testid={`service-preview-retention-${serviceId}`}>
              {previewConfig.staleAfterHours
                ? `Cleanup after ${previewConfig.staleAfterHours}h`
                : "No automatic expiry"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div
            className="rounded-xl border p-4"
            data-testid={`service-preview-summary-total-${serviceId}`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Tracked</p>
            <p className="mt-1 text-2xl font-semibold">{report.summary.totalPreviews}</p>
          </div>
          <div
            className="rounded-xl border p-4"
            data-testid={`service-preview-summary-live-${serviceId}`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Live</p>
            <p className="mt-1 text-2xl font-semibold">{report.summary.activePreviews}</p>
          </div>
          <div
            className="rounded-xl border p-4"
            data-testid={`service-preview-summary-drift-${serviceId}`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Needs attention
            </p>
            <p className="mt-1 text-2xl font-semibold">{report.summary.drifted}</p>
          </div>
          <div
            className="rounded-xl border p-4"
            data-testid={`service-preview-summary-cleanup-${serviceId}`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Cleanup due</p>
            <p className="mt-1 text-2xl font-semibold">{report.summary.gcEligible}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Clock3 size={14} />
            <span className="font-medium">Managed preview domain</span>
            <Badge variant="outline">{previewConfig.domainTemplate ?? "Not configured"}</Badge>
          </div>
          <p className="mt-2 text-muted-foreground">
            {previewConfig.domainTemplate
              ? "Preview domains are isolated from the base environment so retiring a preview only cleans up preview-specific resources."
              : "Preview stacks can still be tracked, but DaoFlow will not be able to verify managed preview routing until a domain template is configured."}
          </p>
        </div>

        {canManagePreviews ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void handlePreviewCleanup(true)}
              disabled={reconcilePreviews.isPending}
              data-testid={`service-preview-dry-run-${serviceId}`}
            >
              <RefreshCw size={14} className="mr-2" />
              Preview cleanup plan
            </Button>
            <Button
              onClick={() => void handlePreviewCleanup(false)}
              disabled={reconcilePreviews.isPending}
              data-testid={`service-preview-run-cleanup-${serviceId}`}
            >
              {reconcilePreviews.isPending ? "Running..." : "Run preview cleanup"}
            </Button>
          </div>
        ) : null}

        {feedback ? (
          <p
            className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground"
            data-testid={`service-preview-feedback-${serviceId}`}
          >
            {feedback}
          </p>
        ) : null}

        {previews.length === 0 ? (
          <Alert data-testid={`service-preview-empty-${serviceId}`}>
            <AlertTriangle size={16} />
            <AlertTitle>No preview history yet</AlertTitle>
            <AlertDescription>
              DaoFlow is ready to keep preview environments separate for {serviceName}. Once a
              preview is requested, this panel will show when it was created, whether cleanup is
              due, and why it still exists.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {previews.map((preview) => (
              <div
                key={preview.key}
                className="rounded-xl border p-4"
                data-testid={`service-preview-item-${serviceId}-${preview.key}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{preview.key}</span>
                      <Badge variant={getBadgeVariantFromTone(preview.latestStatusTone)}>
                        {preview.latestStatusLabel}
                      </Badge>
                      <Badge variant="outline">{previewStateLabel(preview)}</Badge>
                      <Badge variant="outline">
                        {preview.target === "pull-request"
                          ? `PR #${preview.pullRequestNumber ?? "?"}`
                          : "Branch preview"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Branch <span className="font-mono">{preview.branch}</span> · env branch{" "}
                      <span className="font-mono">{preview.envBranch}</span> · stack{" "}
                      <span className="font-mono">{preview.stackName}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Requested {formatRelative(preview.lastRequestedAt)}
                      {preview.lastFinishedAt
                        ? ` · last finished ${formatRelative(preview.lastFinishedAt)}`
                        : ""}
                    </p>
                  </div>
                  {canManagePreviews && preview.latestAction === "deploy" ? (
                    <Button
                      variant="outline"
                      onClick={() => void handleRetirePreview(preview)}
                      disabled={triggerDeploy.isPending && retiringPreviewKey === preview.key}
                      data-testid={`service-preview-retire-${serviceId}-${preview.key}`}
                    >
                      <Trash2 size={14} className="mr-2" />
                      {triggerDeploy.isPending && retiringPreviewKey === preview.key
                        ? "Queueing..."
                        : "Retire preview"}
                    </Button>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <p className="font-medium">Routing</p>
                    <p className="mt-2 text-muted-foreground">
                      {preview.desiredDomain ? (
                        <>
                          Desired domain <span className="font-mono">{preview.desiredDomain}</span>
                        </>
                      ) : (
                        "No managed preview domain configured."
                      )}
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      Route state: {preview.domainStatus}
                      {preview.observedRoute ? ` via ${preview.observedRoute.tunnelName}` : ""}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <p className="font-medium">Cleanup</p>
                    <p className="mt-2 text-muted-foreground">{previewReason(preview)}</p>
                    {preview.staleAt ? (
                      <p className="mt-2 text-muted-foreground">
                        Cleanup eligibility checkpoint: {new Date(preview.staleAt).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
