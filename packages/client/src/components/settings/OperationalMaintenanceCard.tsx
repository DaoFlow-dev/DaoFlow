import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface MaintenanceReport {
  generatedAt: string;
  defaults: {
    cleanupIntervalMs: number;
    previewCleanupBatchLimit: number;
    deploymentWatchdogTimeoutMs: number;
    cliAuthRequestTtlMs: number;
    retainedArtifactWindowMs: number;
    incompleteUploadWindowMs: number;
  };
  current: {
    stalledDeployments: {
      eligibleCount: number;
    };
    stalePreviews: {
      previewEnabledServices: number;
      eligibleCount: number;
      items: Array<{
        serviceName: string;
        previewKey: string;
        staleAt: string | null;
        stackName: string;
      }>;
    };
    expiredCliAuthRequests: {
      eligibleCount: number;
    };
    retainedArtifacts: {
      eligibleCount: number;
      retainedArtifacts: number;
      incompleteUploads: number;
    };
  };
  latestRun: {
    action: string;
    actorEmail: string | null;
    actorId: string;
    outcome: string;
    summary: string;
    createdAt: string;
  } | null;
}

interface OperationalMaintenanceCardProps {
  report: MaintenanceReport | null | undefined;
  isLoading: boolean;
  canManage: boolean;
  isRunning: boolean;
  feedback: string | null;
  onRefresh: () => void;
  onDryRun: () => void;
  onRunNow: () => void;
}

function formatMinutes(ms: number) {
  return `${Math.round(ms / 60_000)} min`;
}

function formatDays(ms: number) {
  return `${Math.round(ms / (24 * 60 * 60 * 1_000))} days`;
}

function maintenanceActionLabel(action: string) {
  switch (action) {
    case "maintenance.cleanup.dry_run":
      return "Dry run";
    case "maintenance.cleanup.monitor":
      return "Background run";
    default:
      return "Manual run";
  }
}

export function OperationalMaintenanceCard({
  report,
  isLoading,
  canManage,
  isRunning,
  feedback,
  onRefresh,
  onDryRun,
  onRunNow
}: OperationalMaintenanceCardProps) {
  return (
    <Card data-testid="settings-operational-maintenance">
      <CardHeader>
        <CardTitle className="text-base">Operational maintenance</CardTitle>
        <CardDescription>
          Background cleanup keeps stalled work, stale previews, expired CLI sign-ins, and replay
          artifacts from piling up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {report ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border p-3" data-testid="maintenance-summary-stalled">
                <p className="text-xs text-muted-foreground">Stalled deployments</p>
                <p className="text-xl font-semibold">
                  {report.current.stalledDeployments.eligibleCount}
                </p>
              </div>
              <div className="rounded-lg border p-3" data-testid="maintenance-summary-previews">
                <p className="text-xs text-muted-foreground">Stale previews</p>
                <p className="text-xl font-semibold">
                  {report.current.stalePreviews.eligibleCount}
                </p>
              </div>
              <div className="rounded-lg border p-3" data-testid="maintenance-summary-cli-auth">
                <p className="text-xs text-muted-foreground">Expired CLI sign-ins</p>
                <p className="text-xl font-semibold">
                  {report.current.expiredCliAuthRequests.eligibleCount}
                </p>
              </div>
              <div className="rounded-lg border p-3" data-testid="maintenance-summary-artifacts">
                <p className="text-xs text-muted-foreground">Retained artifacts</p>
                <p className="text-xl font-semibold">
                  {report.current.retainedArtifacts.eligibleCount}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Background cadence</p>
                <p className="text-sm font-medium">
                  Every {formatMinutes(report.defaults.cleanupIntervalMs)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Watchdog timeout</p>
                <p className="text-sm font-medium">
                  {formatMinutes(report.defaults.deploymentWatchdogTimeoutMs)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Artifact retention</p>
                <p className="text-sm font-medium">
                  {formatDays(report.defaults.retainedArtifactWindowMs)} complete /{" "}
                  {formatMinutes(report.defaults.incompleteUploadWindowMs)} incomplete
                </p>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">Current preview cleanup queue</p>
                <Badge variant="outline">
                  {report.current.stalePreviews.previewEnabledServices} services watched
                </Badge>
                <Badge variant="outline">
                  Batch limit {report.defaults.previewCleanupBatchLimit}
                </Badge>
              </div>
              {report.current.stalePreviews.items.length > 0 ? (
                <div className="mt-3 space-y-2" data-testid="maintenance-preview-items">
                  {report.current.stalePreviews.items.slice(0, 3).map((preview) => (
                    <div
                      key={`${preview.serviceName}-${preview.previewKey}`}
                      className="rounded-md bg-muted/50 px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{preview.serviceName}</span>
                      {" · "}
                      {preview.previewKey}
                      {" · "}
                      {preview.stackName}
                      {preview.staleAt ? (
                        <span className="text-muted-foreground">
                          {" · "}stale since {new Date(preview.staleAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No preview environments are currently eligible for cleanup.
                </p>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Latest recorded cleanup</p>
              {report.latestRun ? (
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <p>
                    {maintenanceActionLabel(report.latestRun.action)} by{" "}
                    {report.latestRun.actorEmail ?? report.latestRun.actorId} on{" "}
                    {new Date(report.latestRun.createdAt).toLocaleString()}
                  </p>
                  <p>{report.latestRun.summary}</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No cleanup cycles have been recorded yet.
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading maintenance report..." : "Maintenance report unavailable."}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onRefresh} data-testid="maintenance-refresh-button">
            Refresh report
          </Button>
          {canManage ? (
            <>
              <Button
                variant="outline"
                onClick={onDryRun}
                disabled={isRunning}
                data-testid="maintenance-dry-run-button"
              >
                Preview cleanup plan
              </Button>
              <Button onClick={onRunNow} disabled={isRunning} data-testid="maintenance-run-button">
                {isRunning ? "Running..." : "Run cleanup now"}
              </Button>
            </>
          ) : null}
        </div>

        {feedback ? (
          <p
            className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground"
            data-testid="maintenance-feedback"
          >
            {feedback}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
