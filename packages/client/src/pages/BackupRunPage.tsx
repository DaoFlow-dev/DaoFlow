import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { BackupRunDetailsContent } from "@/components/backups/BackupRunDetailsContent";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent } from "@/components/ui/card";
import { getBackupOperationBadgeVariant } from "@/lib/tone-utils";
import { useBackupRunDetails } from "@/features/backups/useBackupRunDetails";

export default function BackupRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { errorMessage, query } = useBackupRunDetails(runId);
  const run = query.data;
  const liveStatus = run && (run.status === "queued" || run.status === "running");

  return (
    <main className="shell space-y-6" data-testid="backup-run-page">
      <div className="flex flex-wrap items-start gap-3">
        <Link
          to="/backups"
          className={buttonVariants({ variant: "outline", size: "icon" })}
          aria-label="Back to backups"
          data-testid="backup-run-page-back"
        >
          <ArrowLeft size={18} />
        </Link>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className="font-display text-2xl font-bold tracking-tight"
              data-testid="backup-run-page-title"
            >
              {run ? run.serviceName || run.policyName : "Backup run diagnostics"}
            </h1>
            {run ? (
              <Badge
                variant={getBackupOperationBadgeVariant(run.status)}
                data-testid="backup-run-page-status"
              >
                {run.status}
              </Badge>
            ) : null}
            {liveStatus ? (
              <Badge variant="secondary" data-testid="backup-run-page-live">
                Live polling
              </Badge>
            ) : null}
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground" data-testid="backup-run-page-description">
              {run
                ? `${run.environmentName || "Unknown environment"} · ${run.targetType} backup · ${run.triggerKind}`
                : "Inspect persisted backup execution metadata and logs from a stable URL."}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="backup-run-page-subtitle">
              Use this screen for incident handoff, failed-run triage, and shareable backup
              diagnostics.
            </p>
          </div>
        </div>

        {run ? (
          <Card className="min-w-[220px]" data-testid="backup-run-page-run-id-card">
            <CardContent className="space-y-1 py-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Run ID</p>
              <p className="font-mono text-sm break-all">{run.id}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <BackupRunDetailsContent
        isLoading={query.isLoading}
        errorMessage={errorMessage}
        emptyMessage="This backup run could not be found."
        run={run}
      />
    </main>
  );
}
