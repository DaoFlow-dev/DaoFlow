/**
 * Task #30: Backup timeline view with status dots and duration bars.
 */
import { trpc } from "../../lib/trpc";
import { getBackupOperationTone, getToneDotClass, getToneTextClass } from "../../lib/tone-utils";

export function BackupTimeline() {
  const { data, isLoading } = trpc.backupOverview.useQuery({ limit: 20 });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3" data-testid="backup-timeline-loading">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-muted" />
        ))}
      </div>
    );
  }

  const runs = data?.runs ?? [];

  if (runs.length === 0) {
    return (
      <div
        className="py-10 text-center text-sm text-muted-foreground"
        data-testid="backup-timeline-empty"
      >
        No backup runs yet
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="backup-timeline">
      {runs.map((run) => {
        const tone =
          typeof run.statusTone === "string" ? run.statusTone : getBackupOperationTone(run.status);
        return (
          <div
            key={run.id}
            className="group flex items-center gap-3 rounded-lg border bg-card px-4 py-2 transition-colors hover:bg-muted"
          >
            {/* Status dot */}
            <div
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${getToneDotClass(tone, { pulse: true })}`}
            />

            {/* Policy name */}
            <span className="flex-1 truncate text-sm text-foreground">{run.policyId}</span>

            {/* Status badge */}
            <span className={`rounded-full bg-muted px-2 py-0.5 text-xs ${getToneTextClass(tone)}`}>
              {run.status}
            </span>

            {/* Duration / time */}
            <span className="min-w-[80px] text-right text-xs text-muted-foreground">
              {run.startedAt
                ? new Date(run.startedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  })
                : "---"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
