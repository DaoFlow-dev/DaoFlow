import { describe, expect, test } from "vitest";
import type { NotificationPayload } from "./temporal/activities/notification-sender-types";
import { deliverServerMetricTransitionNotification } from "./server-metric-notification-handler";

const event = {
  serverId: "srv_123",
  serverName: "edge-1",
  teamId: "team_123",
  channelId: "channel_123",
  transition: {
    metricKey: "disk",
    eventType: "server.metrics.warning",
    transitionType: "transition",
    previousState: "healthy",
    nextState: "warning",
    measuredValue: 83,
    thresholdValue: 80,
    occurredAt: new Date("2026-07-19T04:00:00.000Z")
  }
} as const;

describe("server metric notification handler", () => {
  test("maps a persisted channel delivery to the team-owned direct dispatcher", async () => {
    let dispatched: NotificationPayload | null = null;
    let dispatchedChannelId: string | null = null;
    let expectedTeamId: string | undefined;
    let passedNextState: string | null = null;
    const result = await deliverServerMetricTransitionNotification(event, {
      build: (input) => {
        passedNextState = input.nextState;
        return Promise.resolve({
          eventType: input.eventType,
          teamId: input.teamId,
          title: input.serverName,
          message: input.metric ?? "availability",
          severity: "warning",
          timestamp: input.observedAt
        });
      },
      dispatch: (channelId, payload, options) => {
        dispatchedChannelId = channelId;
        expectedTeamId = options?.expectedTeamId;
        dispatched = payload;
        return Promise.resolve({ dispatched: 1, succeeded: 1, failed: 0, results: [] });
      }
    });

    expect(result.succeeded).toBe(1);
    expect(dispatched).toMatchObject({
      eventType: "server.metrics.warning",
      teamId: "team_123",
      title: "edge-1",
      message: "disk"
    });
    expect(dispatchedChannelId).toBe("channel_123");
    expect(expectedTeamId).toBe("team_123");
    expect(passedNextState).toBe("warning");
  });

  test("fails closed so a single channel failure is retried by its outbox row", async () => {
    await expect(
      deliverServerMetricTransitionNotification(event, {
        build: (input) =>
          Promise.resolve({
            eventType: input.eventType,
            teamId: input.teamId,
            title: input.serverName,
            message: "warning",
            severity: "warning"
          }),
        dispatch: () => Promise.resolve({ dispatched: 1, succeeded: 0, failed: 1, results: [] })
      })
    ).rejects.toThrow("Server metric notification delivery failed for channel channel_123.");
  });
});
