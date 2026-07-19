import { buildServerMetricNotification } from "./temporal/activities/notification-builders";
import { dispatchNotificationToChannel } from "./temporal/activities/notification-activities";
import type { NotificationPayload } from "./temporal/activities/notification-sender-types";
import type { ServerMetricOutboxTransition } from "./server-metrics-monitor";

type ServerMetricNotificationBuildInput = Parameters<typeof buildServerMetricNotification>[0] & {
  nextState: ServerMetricOutboxTransition["transition"]["nextState"];
};
export interface ServerMetricNotificationDependencies {
  build: (input: ServerMetricNotificationBuildInput) => Promise<NotificationPayload>;
  dispatch: typeof dispatchNotificationToChannel;
}

const defaultDependencies: ServerMetricNotificationDependencies = {
  build: buildServerMetricNotification,
  dispatch: dispatchNotificationToChannel
};

export async function deliverServerMetricTransitionNotification(
  event: ServerMetricOutboxTransition,
  dependencies: ServerMetricNotificationDependencies = defaultDependencies
) {
  const transition = event.transition;
  const payload = await dependencies.build({
    eventType: transition.eventType,
    teamId: event.teamId,
    serverName: event.serverName,
    metric: transition.metricKey === "availability" ? null : transition.metricKey,
    measuredValue: transition.measuredValue,
    threshold: transition.thresholdValue,
    observedAt: transition.occurredAt.toISOString(),
    nextState: transition.nextState
  });
  const result = await dependencies.dispatch(event.channelId, payload, {
    expectedTeamId: event.teamId
  });
  if (result.succeeded === 0) {
    throw new Error(`Server metric notification delivery failed for channel ${event.channelId}.`);
  }
  return result;
}
