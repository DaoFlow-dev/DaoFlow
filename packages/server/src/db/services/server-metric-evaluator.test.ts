import { describe, expect, it } from "vitest";
import { evaluateServerMetricState } from "./server-metric-evaluator";
import { DEFAULT_SERVER_METRIC_POLICY } from "./server-metric-policy";
import type { ServerMetricState } from "./server-metric-types";
import type { ServerMetricsSnapshot } from "../../worker/server-metrics-collector";

const now = new Date("2026-07-18T12:00:00.000Z");

function snapshot(overrides: Partial<ServerMetricsSnapshot> = {}): ServerMetricsSnapshot {
  return {
    cpuPercent: 20,
    memoryUsedPercent: 20,
    memoryUsedGB: 1,
    memoryTotalGB: 8,
    diskUsedPercent: 20,
    diskTotalGB: 50,
    dockerDiskUsedPercent: 20,
    dockerDiskTotalGB: 50,
    networkInMB: 0,
    networkOutMB: 0,
    ...overrides
  };
}

function state(overrides: Partial<ServerMetricState> = {}): ServerMetricState {
  return {
    currentState: "healthy",
    metricStates: {},
    lastCheckedAt: null,
    lastCollectedAt: null,
    lastUnreachableAt: null,
    lastTransitionAt: null,
    lastAlertAt: null,
    ...overrides,
    collectionGeneration: overrides.collectionGeneration ?? 0
  };
}

describe("server metric evaluator", () => {
  it("emits warning and hard transitions with measured values, thresholds, and timestamps", () => {
    const policy = {
      ...DEFAULT_SERVER_METRIC_POLICY,
      cpuWarnPercent: 80,
      cpuHardPercent: 90,
      cooldownMinutes: 0
    };
    const warning = evaluateServerMetricState({
      policy,
      snapshot: snapshot({ cpuPercent: 85 }),
      previousState: state(),
      now
    });

    expect(warning.currentState).toBe("warning");
    expect(warning.alerts).toEqual([
      expect.objectContaining({
        eventType: "server.metrics.warning",
        metricKey: "cpu",
        previousState: "healthy",
        nextState: "warning",
        measuredValue: 85,
        thresholdValue: 80,
        occurredAt: now
      })
    ]);

    const hard = evaluateServerMetricState({
      policy,
      snapshot: snapshot({ cpuPercent: 94 }),
      previousState: state({ currentState: "warning", metricStates: warning.metricStates }),
      now
    });

    expect(hard.currentState).toBe("hard");
    expect(hard.alerts[0]).toMatchObject({
      eventType: "server.metrics.hard",
      previousState: "warning",
      nextState: "hard",
      thresholdValue: 90
    });
  });

  it("holds an alerting state through hysteresis and emits one recovery after the clear boundary", () => {
    const policy = {
      ...DEFAULT_SERVER_METRIC_POLICY,
      cpuWarnPercent: 80,
      cooldownMinutes: 0
    };
    const previous = state({ currentState: "warning", metricStates: { cpu: "warning" } });
    const held = evaluateServerMetricState({
      policy,
      snapshot: snapshot({ cpuPercent: 76 }),
      previousState: previous,
      now
    });
    expect(held.currentState).toBe("warning");
    expect(held.transitions).toHaveLength(0);

    const recovered = evaluateServerMetricState({
      policy,
      snapshot: snapshot({ cpuPercent: 74 }),
      previousState: previous,
      now
    });
    expect(recovered.currentState).toBe("healthy");
    expect(recovered.alerts).toEqual([
      expect.objectContaining({
        eventType: "server.metrics.recovered",
        previousState: "warning",
        nextState: "healthy",
        measuredValue: 74,
        thresholdValue: 80
      })
    ]);
  });

  it("treats zero thresholds as disabled even when the measured values are high", () => {
    const evaluated = evaluateServerMetricState({
      policy: { ...DEFAULT_SERVER_METRIC_POLICY, cooldownMinutes: 0 },
      snapshot: snapshot({
        cpuPercent: 99,
        memoryUsedPercent: 99,
        diskUsedPercent: 99,
        dockerDiskUsedPercent: 99
      }),
      previousState: state(),
      now
    });

    expect(evaluated.currentState).toBe("healthy");
    expect(evaluated.transitions).toHaveLength(0);
  });

  it("queues transitions during cooldown so delivery can record a durable suppression", () => {
    const evaluated = evaluateServerMetricState({
      policy: {
        ...DEFAULT_SERVER_METRIC_POLICY,
        diskWarnPercent: 80,
        cooldownMinutes: 30
      },
      snapshot: snapshot({ diskUsedPercent: 85 }),
      previousState: state({ lastAlertAt: new Date(now.getTime() - 5 * 60_000) }),
      now
    });

    expect(evaluated.currentState).toBe("warning");
    expect(evaluated.transitions).toHaveLength(1);
    expect(evaluated.alerts).toHaveLength(1);
  });

  it("represents unreachable hosts distinctly and emits a recovery when collection resumes", () => {
    const unavailable = evaluateServerMetricState({
      policy: { ...DEFAULT_SERVER_METRIC_POLICY, cooldownMinutes: 0 },
      snapshot: null,
      previousState: state({ currentState: "warning", metricStates: { cpu: "warning" } }),
      now
    });
    expect(unavailable.currentState).toBe("unreachable");
    expect(unavailable.alerts[0]).toMatchObject({
      eventType: "server.metrics.unreachable",
      metricKey: "availability",
      previousState: "warning",
      nextState: "unreachable"
    });

    const recovered = evaluateServerMetricState({
      policy: { ...DEFAULT_SERVER_METRIC_POLICY, cooldownMinutes: 0 },
      snapshot: snapshot(),
      previousState: state({ currentState: "unreachable", metricStates: unavailable.metricStates }),
      now
    });
    expect(recovered.currentState).toBe("healthy");
    expect(recovered.alerts[0]).toMatchObject({
      eventType: "server.metrics.recovered",
      metricKey: "availability",
      previousState: "unreachable",
      nextState: "healthy"
    });
  });

  it("queues availability recovery alongside a hard threshold transition", () => {
    const evaluated = evaluateServerMetricState({
      policy: {
        ...DEFAULT_SERVER_METRIC_POLICY,
        cpuHardPercent: 90,
        cooldownMinutes: 30
      },
      snapshot: snapshot({ cpuPercent: 95 }),
      previousState: state({ currentState: "unreachable", metricStates: { cpu: "warning" } }),
      now
    });

    expect(evaluated.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: "availability",
          eventType: "server.metrics.recovered",
          previousState: "unreachable",
          nextState: "hard"
        }),
        expect.objectContaining({
          metricKey: "cpu",
          eventType: "server.metrics.hard",
          previousState: "warning",
          nextState: "hard"
        })
      ])
    );
  });

  it("preserves an enabled metric's threshold state when its measurement is unavailable", () => {
    const evaluated = evaluateServerMetricState({
      policy: {
        ...DEFAULT_SERVER_METRIC_POLICY,
        dockerDiskWarnPercent: 80,
        dockerDiskHardPercent: 90,
        cooldownMinutes: 0
      },
      snapshot: snapshot({ dockerDiskUsedPercent: null }),
      previousState: state({
        currentState: "hard",
        metricStates: { dockerDisk: "hard" }
      }),
      now
    });

    expect(evaluated.currentState).toBe("hard");
    expect(evaluated.metricStates.dockerDisk).toBe("hard");
    expect(evaluated.transitions).toEqual([]);
  });

  it("queues metric recovery alongside availability recovery after an outage", () => {
    const evaluated = evaluateServerMetricState({
      policy: {
        ...DEFAULT_SERVER_METRIC_POLICY,
        diskWarnPercent: 80,
        cooldownMinutes: 30
      },
      snapshot: snapshot({ diskUsedPercent: 60 }),
      previousState: state({ currentState: "unreachable", metricStates: { disk: "warning" } }),
      now
    });

    expect(evaluated.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: "availability",
          eventType: "server.metrics.recovered",
          previousState: "unreachable"
        }),
        expect.objectContaining({
          metricKey: "disk",
          eventType: "server.metrics.recovered",
          previousState: "warning",
          nextState: "healthy"
        })
      ])
    );
  });
});
