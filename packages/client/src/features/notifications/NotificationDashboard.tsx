/**
 * Task #68: Notification dashboard widget — recent notifications,
 * delivery success rate, filter by channel type.
 */

const MOCK_STATS = {
  delivered: 142,
  failed: 3,
  channels: { slack: 80, discord: 35, email: 15, push: 12, webhook: 3 }
};

export function NotificationDashboard() {
  const total = MOCK_STATS.delivered + MOCK_STATS.failed;
  const rate = total > 0 ? Math.round((MOCK_STATS.delivered / total) * 100) : 100;

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
          <div className="text-2xl font-bold text-white">{MOCK_STATS.delivered}</div>
          <div className="text-xs text-white/40 mt-1">delivered</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-400">{MOCK_STATS.failed}</div>
          <div className="text-xs text-white/40 mt-1">failed</div>
        </div>
      </div>

      {/* Channel breakdown */}
      <div className="space-y-2">
        {Object.entries(MOCK_STATS.channels).map(([channel, count]) => (
          <div key={channel} className="flex items-center gap-2">
            <span className="text-xs text-white/50 w-16">{channel}</span>
            <div className="flex-1 bg-white/5 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-full rounded-full transition-all"
                style={{ width: `${(count / MOCK_STATS.delivered) * 100}%` }}
              />
            </div>
            <span className="text-xs text-white/40 w-8 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
