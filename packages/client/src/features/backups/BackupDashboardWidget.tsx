/**
 * Task #29: Backup health dashboard widget.
 * Shows protection coverage %, last success, next scheduled, failed count.
 */
import { trpc } from "../../lib/trpc";

export function BackupDashboardWidget() {
  const { data: metrics, isLoading } = trpc.backupMetrics.useQuery();

  if (isLoading) {
    return (
      <div className="card animate-pulse" data-testid="backup-widget-loading">
        <div className="h-32 bg-white/5 rounded" />
      </div>
    );
  }

  if (!metrics) return null;

  const successRate = metrics.last7d.successRate;
  const rateColor =
    successRate >= 90 ? "text-emerald-400" : successRate >= 70 ? "text-amber-400" : "text-red-400";

  return (
    <div className="card p-6" data-testid="backup-dashboard-widget">
      <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-4">
        Backup Health
      </h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Success Rate */}
        <div className="text-center">
          <div className={`text-3xl font-bold ${rateColor}`}>{successRate}%</div>
          <div className="text-xs text-white/40 mt-1">7-day success rate</div>
        </div>

        {/* Total Runs */}
        <div className="text-center">
          <div className="text-3xl font-bold text-white">{metrics.overall.totalRuns}</div>
          <div className="text-xs text-white/40 mt-1">total runs</div>
        </div>

        {/* Running */}
        <div className="text-center">
          <div className="text-2xl font-semibold text-blue-400">{metrics.overall.running}</div>
          <div className="text-xs text-white/40 mt-1">running now</div>
        </div>

        {/* Failed */}
        <div className="text-center">
          <div className="text-2xl font-semibold text-red-400">{metrics.overall.failed}</div>
          <div className="text-xs text-white/40 mt-1">failed</div>
        </div>
      </div>

      {/* Size Summary */}
      <div className="mt-4 pt-4 border-t border-white/10 text-center">
        <span className="text-xs text-white/40">
          30d storage:{" "}
          <span className="text-white/70">
            {(metrics.last30d.totalSizeBytes / 1024 / 1024).toFixed(1)} MB
          </span>
        </span>
        <span className="text-white/20 mx-2">·</span>
        <span className="text-xs text-white/40">
          Avg duration: <span className="text-white/70">{metrics.last7d.avgDurationSec}s</span>
        </span>
      </div>
    </div>
  );
}
