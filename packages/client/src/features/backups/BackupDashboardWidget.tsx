/**
 * Task #29: Backup health dashboard widget.
 * Shows protection coverage %, last success, next scheduled, failed count.
 */
import { Card } from "@/components/ui/card";
import { trpc } from "../../lib/trpc";

export function BackupDashboardWidget() {
  const { data: metrics, isLoading } = trpc.backupMetrics.useQuery();

  if (isLoading) {
    return (
      <Card className="animate-pulse p-6" data-testid="backup-widget-loading">
        <div className="h-32 rounded bg-muted" />
      </Card>
    );
  }

  if (!metrics) return null;

  const successRate = metrics.last7d.successRate;
  const rateColor =
    successRate >= 90 ? "text-emerald-400" : successRate >= 70 ? "text-amber-400" : "text-red-400";

  return (
    <Card className="p-6" data-testid="backup-dashboard-widget">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
        Backup Health
      </h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Success Rate */}
        <div className="text-center">
          <div className={`text-3xl font-bold ${rateColor}`}>{successRate}%</div>
          <div className="mt-1 text-xs text-muted-foreground">7-day success rate</div>
        </div>

        {/* Total Runs */}
        <div className="text-center">
          <div className="text-3xl font-bold text-foreground">{metrics.overall.totalRuns}</div>
          <div className="mt-1 text-xs text-muted-foreground">total runs</div>
        </div>

        {/* Running */}
        <div className="text-center">
          <div className="text-2xl font-semibold text-blue-400">{metrics.overall.running}</div>
          <div className="mt-1 text-xs text-muted-foreground">running now</div>
        </div>

        {/* Failed */}
        <div className="text-center">
          <div className="text-2xl font-semibold text-red-400">{metrics.overall.failed}</div>
          <div className="mt-1 text-xs text-muted-foreground">failed</div>
        </div>
      </div>

      {/* Size Summary */}
      <div className="mt-4 border-t border-border pt-4 text-center">
        <span className="text-xs text-muted-foreground">
          30d storage:{" "}
          <span className="text-foreground">
            {(metrics.last30d.totalSizeBytes / 1024 / 1024).toFixed(1)} MB
          </span>
        </span>
        <span className="mx-2 text-muted-foreground/30">·</span>
        <span className="text-xs text-muted-foreground">
          Avg duration: <span className="text-foreground">{metrics.last7d.avgDurationSec}s</span>
        </span>
      </div>
    </Card>
  );
}
