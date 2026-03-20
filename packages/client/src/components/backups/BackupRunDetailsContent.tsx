import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatBytes } from "@/lib/tone-utils";

export interface BackupRunDetailsView {
  id: string;
  policyId: string;
  policyName: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetType: string;
  destinationName: string;
  destinationProvider: string | null;
  destinationServerName: string;
  mountPath: string | null;
  backupType: string;
  databaseEngine: string | null;
  scheduleLabel: string | null;
  retentionCount: number | null;
  status: string;
  triggerKind: string;
  requestedBy: string;
  artifactPath: string | null;
  bytesWritten: number | null;
  checksum: string | null;
  verifiedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  restoreCount: number;
  logsState: "unavailable" | "empty" | "streaming" | "available";
  logEntries: Array<{
    timestamp: string;
    level: "info" | "warn" | "error";
    phase: string;
    message: string;
  }>;
}

interface BackupRunDetailsContentProps {
  isLoading: boolean;
  errorMessage: string | null;
  emptyMessage?: string;
  run: BackupRunDetailsView | null | undefined;
}

function formatBackupRunDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}

function getBackupRunLogStateMessage(run: BackupRunDetailsView) {
  if (run.logsState === "unavailable") {
    return "This run does not have persisted logs. It likely predates backup log capture.";
  }

  if (run.logsState === "empty") {
    return "This run supports persisted logs, but no entries were recorded.";
  }

  if (run.logsState === "streaming") {
    return "This backup run is still active. New log entries appear here as they are persisted.";
  }

  return null;
}

export function BackupRunDetailsContent({
  isLoading,
  errorMessage,
  emptyMessage = "Select a backup run to inspect its diagnostics.",
  run
}: BackupRunDetailsContentProps) {
  const logStateMessage = run ? getBackupRunLogStateMessage(run) : null;

  return (
    <div className="space-y-6">
      {isLoading ? (
        <Card data-testid="backup-run-details-loading">
          <CardContent className="py-10 text-sm text-muted-foreground">
            Loading backup run diagnostics...
          </CardContent>
        </Card>
      ) : errorMessage ? (
        <Card data-testid="backup-run-details-error">
          <CardContent className="py-10 text-sm text-destructive">{errorMessage}</CardContent>
        </Card>
      ) : run ? (
        <>
          {run.error ? (
            <Card data-testid="backup-run-details-failure-summary">
              <CardHeader>
                <CardTitle className="text-sm">Failure summary</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-destructive">{run.error}</CardContent>
            </Card>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2" data-testid={`backup-run-meta-${run.id}`}>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Run context</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Project</p>
                  <p>{run.projectName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Environment
                  </p>
                  <p>{run.environmentName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Requested by
                  </p>
                  <p>{run.requestedBy}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Started</p>
                  <p>{formatBackupRunDateTime(run.startedAt)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Finished</p>
                  <p>{formatBackupRunDateTime(run.finishedAt)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Backup target</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Destination
                  </p>
                  <p>{run.destinationName}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Server</p>
                  <p>{run.destinationServerName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Mount path
                  </p>
                  <p className="break-all">{run.mountPath || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Artifact</p>
                  <p className="break-all">{run.artifactPath || "Not created"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Bytes written
                  </p>
                  <p>{run.bytesWritten === null ? "—" : formatBytes(run.bytesWritten)}</p>
                </div>
              </CardContent>
            </Card>
          </section>

          <Card data-testid={`backup-run-diagnostics-${run.id}`}>
            <CardHeader>
              <CardTitle className="text-sm">Diagnostics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Backup type
                  </p>
                  <p>
                    {run.databaseEngine
                      ? `${run.backupType} (${run.databaseEngine})`
                      : run.backupType}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Checksum</p>
                  <p className="break-all">{run.checksum || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Verified at
                  </p>
                  <p>{formatBackupRunDateTime(run.verifiedAt)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Schedule</p>
                  <p>{run.scheduleLabel || "Manual only"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Retention
                  </p>
                  <p>{run.retentionCount === null ? "—" : `${run.retentionCount} days`}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Restore requests
                  </p>
                  <p>{run.restoreCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid={`backup-run-logs-${run.id}`}>
            <CardHeader>
              <CardTitle className="text-sm">Execution logs</CardTitle>
            </CardHeader>
            <CardContent>
              {logStateMessage ? (
                <p
                  className="mb-4 text-sm text-muted-foreground"
                  data-testid="backup-run-log-state"
                >
                  {logStateMessage}
                </p>
              ) : null}

              {run.logEntries.length > 0 ? (
                <div className="overflow-hidden rounded-lg border">
                  {run.logEntries.map((entry, index) => (
                    <div key={`${entry.timestamp}-${index}`}>
                      <div
                        className="grid gap-2 bg-card px-4 py-3 text-sm md:grid-cols-[168px_96px_minmax(0,1fr)]"
                        data-testid={`backup-run-log-entry-${index}`}
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatBackupRunDateTime(entry.timestamp)}
                        </span>
                        <span
                          className={
                            entry.level === "error"
                              ? "font-medium text-destructive"
                              : entry.level === "warn"
                                ? "font-medium text-amber-600"
                                : "font-medium text-foreground"
                          }
                        >
                          {entry.phase}
                        </span>
                        <span>{entry.message}</span>
                      </div>
                      {index < run.logEntries.length - 1 ? <Separator /> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card data-testid="backup-run-details-empty">
          <CardContent className="py-10 text-sm text-muted-foreground">{emptyMessage}</CardContent>
        </Card>
      )}
    </div>
  );
}
