/**
 * Task #68: Notification dashboard widget — recent notifications,
 * delivery success rate, filter by channel type.
 * Wired to tRPC listDeliveryLogs for live stats.
 */
import { trpc } from "../../lib/trpc";
import { useSession } from "../../lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";

export function NotificationDashboard() {
  const session = useSession();
  const logsQuery = trpc.listDeliveryLogs.useQuery(
    { limit: 100 },
    { enabled: Boolean(session.data) }
  );

  const logs = logsQuery.data ?? [];

  // Compute stats from real data
  const delivered = logs.filter((l) => l.status === "delivered").length;
  const failed = logs.filter((l) => l.status === "failed").length;
  const total = delivered + failed;
  const rate = total > 0 ? Math.round((delivered / total) * 100) : 100;

  // Channel breakdown (count by channelId — ideally we'd join channel names)
  const channelCounts = new Map<string, number>();
  for (const log of logs) {
    if (log.status === "delivered") {
      channelCounts.set(log.channelId, (channelCounts.get(log.channelId) ?? 0) + 1);
    }
  }
  const channelEntries = Array.from(channelCounts.entries()).sort((a, b) => b[1] - a[1]);

  if (logsQuery.isLoading) {
    return (
      <div className="card p-6" data-testid="notification-dashboard-widget">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="card p-6" data-testid="notification-dashboard-widget">
      <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-4">
        Notifications
      </h3>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-emerald-400">{rate}%</div>
          <div className="text-xs text-white/40 mt-1">delivery rate</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{delivered}</div>
          <div className="text-xs text-white/40 mt-1">delivered</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-400">{failed}</div>
          <div className="text-xs text-white/40 mt-1">failed</div>
        </div>
      </div>

      {/* Channel breakdown */}
      {channelEntries.length > 0 ? (
        <div className="space-y-2">
          {channelEntries.map(([channelId, count]) => (
            <div key={channelId} className="flex items-center gap-2">
              <span className="text-xs text-white/50 w-20 truncate">{channelId}</span>
              <div className="flex-1 bg-white/5 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all"
                  style={{ width: `${(count / Math.max(delivered, 1)) * 100}%` }}
                />
              </div>
              <span className="text-xs text-white/40 w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-white/30 text-center">No delivery data yet</p>
      )}
    </div>
  );
}
