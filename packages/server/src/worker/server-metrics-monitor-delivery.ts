import type { ClaimedServerMetricOutboxDelivery } from "../db/services/server-metric-outbox";
import type {
  ServerMetricMonitorClock,
  ServerMetricMonitorDependencies,
  ServerMetricOutboxTransition,
  ServerMetricTransitionHandler
} from "./server-metrics-monitor";

function startServerMetricOutboxLeaseHeartbeat(input: {
  clock: ServerMetricMonitorClock;
  delivery: ClaimedServerMetricOutboxDelivery;
  dependencies: Pick<ServerMetricMonitorDependencies, "renewOutboxLease">;
}) {
  const intervalMs = Math.max(1, Math.floor(input.delivery.leaseDurationMs / 3));
  let stopped = false;
  let renewal: Promise<void> | null = null;
  let ownsLease = true;

  const renew = () => {
    if (stopped || !ownsLease || renewal) return;
    renewal = input.dependencies
      .renewOutboxLease({ delivery: input.delivery, now: input.clock() })
      .then((renewed) => {
        if (!renewed) ownsLease = false;
      })
      .catch(() => {
        ownsLease = false;
      })
      .finally(() => {
        renewal = null;
      });
  };

  const timer = setInterval(renew, intervalMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await renewal;
      return ownsLease;
    }
  };
}

export async function deliverServerMetricOutboxEntry(input: {
  owner: string;
  clock: ServerMetricMonitorClock;
  dependencies: ServerMetricMonitorDependencies;
  onTransition: ServerMetricTransitionHandler;
}): Promise<{ delivered: number; suppressed: number }> {
  const delivery = await input.dependencies.claimOutbox({ owner: input.owner, now: input.clock() });
  if (!delivery) return { delivered: 0, suppressed: 0 };
  const decision = await input.dependencies.claimOutboxCooldown({ delivery, now: input.clock() });
  if (decision === "suppressed") return { delivered: 0, suppressed: 1 };
  if (decision !== "deliver") return { delivered: 0, suppressed: 0 };
  const event: ServerMetricOutboxTransition = {
    serverId: delivery.serverId,
    serverName: delivery.serverName,
    teamId: delivery.teamId,
    channelId: delivery.channelId,
    transition: delivery.transition
  };
  const heartbeat = startServerMetricOutboxLeaseHeartbeat({
    clock: input.clock,
    delivery,
    dependencies: input.dependencies
  });
  try {
    await input.onTransition(event);
    if (!(await heartbeat.stop())) return { delivered: 0, suppressed: 0 };
    const finalized = await input.dependencies.markOutboxSent({
      delivery,
      now: input.clock()
    });
    if (!finalized) return { delivered: 0, suppressed: 0 };
    return { delivered: 1, suppressed: 0 };
  } catch (error) {
    if (await heartbeat.stop()) {
      await input.dependencies.markOutboxFailure({ delivery, error, now: input.clock() });
    }
    return { delivered: 0, suppressed: 0 };
  }
}
