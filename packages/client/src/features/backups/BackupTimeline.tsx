/**
 * Task #30: Backup timeline view with status dots and duration bars.
 */
import { trpc } from "../../lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-emerald-400",
  failed: "bg-red-400",
  running: "bg-blue-400 animate-pulse",
  queued: "bg-white/30"
};

export function BackupTimeline() {
  const { data, isLoading } = trpc.backupOverview.useQuery({ limit: 20 });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3" data-testid="backup-timeline-loading">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-white/5 rounded" />
        ))}
      </div>
    );
  }

  const runs = data?.runs ?? [];

  if (runs.length === 0) {
    return (
      <div className="text-center text-white/40 py-8" data-testid="backup-timeline-empty">
        No backup runs yet
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="backup-timeline">
      {runs.map((run) => {
        const color = STATUS_COLORS[run.status] ?? "bg-white/20";
        return (
          <div
            key={run.id}
            className="flex items-center gap-3 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
          >
            {/* Status dot */}
            <div className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />

            {/* Policy name */}
            <span className="text-sm text-white/80 truncate flex-1">{run.policyId}</span>

            {/* Status badge */}
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60">
              {run.status}
            </span>

            {/* Duration / time */}
            <span className="text-xs text-white/40 min-w-[80px] text-right">
              {run.startedAt
                ? new Date(run.startedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  })
                : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
