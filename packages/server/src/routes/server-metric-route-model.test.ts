import { describe, expect, test } from "vitest";
import { DEFAULT_SERVER_METRIC_POLICY } from "../db/services/server-metric-policy";
import { serializeServerMetricMonitoring } from "./server-metric-route-model";

describe("server metric route model", () => {
  test("serializes persisted dates and exposes the latest transition details", () => {
    const report: Parameters<typeof serializeServerMetricMonitoring>[0] = {
      serverId: "srv_123",
      policy: { sampleIntervalSeconds: 60, diskWarnPercent: 80 },
      state: {
        currentState: "warning",
        metricStates: { disk: "warning" },
        lastCheckedAt: new Date("2026-07-19T04:00:00.000Z"),
        lastCollectedAt: new Date("2026-07-19T04:00:00.000Z"),
        lastUnreachableAt: null,
        lastTransitionAt: new Date("2026-07-19T04:00:00.000Z"),
        lastAlertAt: new Date("2026-07-19T04:00:01.000Z")
      },
      latest: {
        id: "metric_1",
        serverId: "srv_123",
        cpuPercent: 20,
        memoryUsedPercent: 50,
        memoryUsedGB: 4,
        memoryTotalGB: 8,
        diskUsedPercent: 83,
        diskTotalGB: 100,
        dockerDiskUsedPercent: 30,
        dockerDiskTotalGB: 20,
        networkInMB: 10,
        networkOutMB: 5,
        collectedAt: new Date("2026-07-19T04:00:00.000Z")
      },
      history: [],
      alerts: [
        {
          id: "alert_1",
          serverId: "srv_123",
          metricKey: "disk",
          eventType: "server.metrics.warning",
          transitionType: "transition",
          previousState: "healthy",
          nextState: "warning",
          measuredValue: 83,
          thresholdValue: 80,
          occurredAt: new Date("2026-07-19T04:00:00.000Z"),
          notifiedAt: new Date("2026-07-19T04:00:01.000Z")
        }
      ]
    };

    const serialized = serializeServerMetricMonitoring(report);

    expect(serialized.state).toEqual({
      status: "warning",
      metric: "disk",
      measuredValue: 83,
      threshold: 80,
      activeMetrics: [
        {
          metric: "disk",
          status: "warning",
          measuredValue: 83,
          threshold: 80
        }
      ],
      changedAt: "2026-07-19T04:00:00.000Z",
      lastAlertedAt: "2026-07-19T04:00:01.000Z",
      error: null
    });
    expect(serialized.latest?.collectedAt).toBe("2026-07-19T04:00:00.000Z");
    expect(serialized.alerts[0]?.notifiedAt).toBe("2026-07-19T04:00:01.000Z");
  });

  test("does not present an old threshold alert as the active healthy state", () => {
    const serialized = serializeServerMetricMonitoring({
      serverId: "srv_123",
      policy: DEFAULT_SERVER_METRIC_POLICY,
      state: {
        currentState: "healthy",
        metricStates: { disk: "healthy" },
        lastCheckedAt: new Date("2026-07-19T05:00:00.000Z"),
        lastCollectedAt: new Date("2026-07-19T05:00:00.000Z"),
        lastUnreachableAt: null,
        lastTransitionAt: new Date("2026-07-19T05:00:00.000Z"),
        lastAlertAt: new Date("2026-07-19T04:00:00.000Z")
      },
      latest: null,
      history: [],
      alerts: [
        {
          id: "alert_1",
          serverId: "srv_123",
          metricKey: "disk",
          eventType: "server.metrics.warning",
          transitionType: "transition",
          previousState: "healthy",
          nextState: "warning",
          measuredValue: 83,
          thresholdValue: 80,
          occurredAt: new Date("2026-07-19T04:00:00.000Z"),
          notifiedAt: new Date("2026-07-19T04:00:01.000Z")
        }
      ]
    });

    expect(serialized.state).toMatchObject({
      status: "healthy",
      metric: null,
      measuredValue: null,
      threshold: null
    });
  });
});
