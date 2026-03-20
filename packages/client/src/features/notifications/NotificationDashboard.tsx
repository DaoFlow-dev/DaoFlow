/**
 * Task #68: Notification dashboard widget -- recent notifications,
 * delivery success rate, filter by channel type.
 * Wired to tRPC listDeliveryLogs for live stats.
 */
import { trpc } from "../../lib/trpc";
import { useSession } from "../../lib/auth-client";
import { Card } from "@/components/ui/card";
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

  // Channel breakdown (count by channelId -- ideally we'd join channel names)
  const channelCounts = new Map<string, number>();
  for (const log of logs) {
    if (log.status === "delivered") {
      channelCounts.set(log.channelId, (channelCounts.get(log.channelId) ?? 0) + 1);
    }
  }
  const channelEntries = Array.from(channelCounts.entries()).sort((a, b) => b[1] - a[1]);

  if (logsQuery.isLoading) {
    return (
      <Card className="p-6" data-testid="notification-dashboard-widget">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  return (
    <Card className="p-6" data-testid="notification-dashboard-widget">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
        Notifications
      </h3>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-emerald-400">{rate}%</div>
          <div className="mt-1 text-xs text-muted-foreground">delivery rate</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-foreground">{delivered}</div>
          <div className="mt-1 text-xs text-muted-foreground">delivered</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-400">{failed}</div>
          <div className="mt-1 text-xs text-muted-foreground">failed</div>
        </div>
      </div>

      {/* Channel breakdown */}
      {channelEntries.length > 0 ? (
        <div className="space-y-2">
          {channelEntries.map(([channelId, count]) => (
            <div key={channelId} className="flex items-center gap-2">
              <span className="w-20 truncate text-xs text-muted-foreground">{channelId}</span>
              <div className="h-1.5 flex-1 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${(count / Math.max(delivered, 1)) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right text-xs text-muted-foreground">{count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">No delivery data yet</p>
      )}
    </Card>
  );
}
