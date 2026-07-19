import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVER_METRIC_POLICY } from "../db/services/server-metric-policy";
import type { ServerMetricCollectionLease } from "../db/services/server-metric-lease";
import type { ServerMetricMonitoringCandidate } from "../db/services/server-metrics";
import type { ServerMetricState } from "../db/services/server-metric-types";
import type { ServerMetricsSnapshot } from "./server-metrics-collector";
import {
  runServerMetricsMonitorCycle,
  startServerMetricsMonitor,
  stopServerMetricsMonitor
} from "./server-metrics-monitor";

const now = new Date("2026-07-18T12:00:00.000Z");
const metricSnapshot: ServerMetricsSnapshot = {
  cpuPercent: 90,
  memoryUsedPercent: 10,
  memoryUsedGB: 1,
  memoryTotalGB: 8,
  diskUsedPercent: 10,
  diskTotalGB: 50,
  dockerDiskUsedPercent: 10,
  dockerDiskTotalGB: 50,
  networkInMB: 1,
  networkOutMB: 1
};

function initialState(): ServerMetricState {
  return {
    currentState: "healthy",
    metricStates: {},
    lastCheckedAt: null,
    lastCollectedAt: null,
    lastUnreachableAt: null,
    lastTransitionAt: null,
    lastAlertAt: null,
    collectionGeneration: 0
  };
}

function candidate(id: string): ServerMetricMonitoringCandidate {
  return {
    server: { id, name: id, teamId: "team-1" } as ServerMetricMonitoringCandidate["server"],
    policy: { ...DEFAULT_SERVER_METRIC_POLICY, cpuHardPercent: 85, cooldownMinutes: 0 },
    state: initialState()
  };
}

function lease(serverId: string, token = `token-${serverId}`): ServerMetricCollectionLease {
  return {
    serverId,
    owner: "replica-a",
    token,
    generation: 1,
    expiresAt: new Date(now.getTime() + 60_000)
  };
}

const noOutbox = {
  claimOutbox: () => Promise.resolve(null),
  claimOutboxCooldown: () => Promise.resolve("lost" as const),
  markOutboxSent: () => Promise.resolve(null),
  markOutboxFailure: () => Promise.resolve(null)
};

describe("server metrics monitor", () => {
  it("persists the transition/outbox transaction before retention; retention failure cannot discard it", async () => {
    const order: string[] = [];
    const persisted: Array<{ transitions: string[] }> = [];
    const result = await runServerMetricsMonitorCycle({
      clock: () => new Date(now),
      outboxLimit: 0,
      dependencies: {
        listDueServers: () => Promise.resolve([candidate("srv-1")]),
        claimCollection: ({ serverId }) => Promise.resolve(lease(serverId)),
        resolveTarget: () => Promise.resolve({ mode: "local" }),
        collectMetrics: () => Promise.resolve(metricSnapshot),
        persistCollection: (input) => {
          order.push("persist");
          persisted.push({
            transitions: input.transitions.map((transition) => transition.eventType)
          });
          return Promise.resolve(input.transitions.length);
        },
        pruneSamples: () => {
          order.push("prune");
          return Promise.reject(new Error("retention unavailable"));
        },
        ...noOutbox
      }
    });

    expect(order).toEqual(["persist", "prune"]);
    expect(persisted).toEqual([{ transitions: ["server.metrics.hard"] }]);
    expect(result.failures).toEqual([
      expect.objectContaining({ serverId: "srv-1", message: "retention unavailable" })
    ]);
  });

  it("allows only one replica to collect a candidate and does not let a stale token persist", async () => {
    let claimed = false;
    const writes: string[] = [];
    const dependencies = {
      listDueServers: () => Promise.resolve([candidate("srv-1")]),
      claimCollection: ({ serverId }: { serverId: string }) => {
        if (claimed) return Promise.resolve(null);
        claimed = true;
        return Promise.resolve(lease(serverId));
      },
      resolveTarget: () => Promise.resolve({ mode: "local" as const }),
      collectMetrics: () => Promise.resolve(metricSnapshot),
      persistCollection: (input: { lease: ServerMetricCollectionLease }) => {
        if (input.lease.token !== "token-srv-1") return Promise.reject(new Error("stale token"));
        writes.push(input.lease.token);
        return Promise.resolve(1);
      },
      pruneSamples: () => Promise.resolve(0),
      ...noOutbox
    };
    const [first, second] = await Promise.all([
      runServerMetricsMonitorCycle({
        clock: () => new Date(now),
        outboxLimit: 0,
        owner: "replica-a",
        dependencies
      }),
      runServerMetricsMonitorCycle({
        clock: () => new Date(now),
        outboxLimit: 0,
        owner: "replica-b",
        dependencies
      })
    ]);

    expect(first.processedCount + second.processedCount).toBe(1);
    expect(writes).toEqual(["token-srv-1"]);
  });

  it("delivers queued outbox work and keeps notification retry behavior independent of collection", async () => {
    let pending = true;
    let attempts = 0;
    const result = await runServerMetricsMonitorCycle({
      clock: () => new Date(now),
      outboxLimit: 1,
      onTransition: () => {
        attempts += 1;
        return Promise.reject(new Error("channel unavailable"));
      },
      dependencies: {
        listDueServers: () => Promise.resolve([]),
        claimOutbox: () => {
          if (!pending) return Promise.resolve(null);
          pending = false;
          return Promise.resolve({
            outboxId: "outbox-1",
            alertId: "alert-1",
            serverId: "srv-1",
            channelId: "channel-1",
            serverName: "edge-1",
            teamId: "team-1",
            cooldownMinutes: 30,
            leaseOwner: "replica-a",
            leaseToken: "lease-1",
            leaseDurationMs: 30_000,
            transition: {
              metricKey: "cpu",
              eventType: "server.metrics.hard",
              transitionType: "transition",
              previousState: "warning",
              nextState: "hard",
              measuredValue: 95,
              thresholdValue: 90,
              occurredAt: now
            }
          });
        },
        claimOutboxCooldown: () => Promise.resolve("deliver" as const),
        markOutboxSent: () => Promise.resolve(null),
        markOutboxFailure: ({ error }: { error: unknown }) => {
          expect(error).toBeInstanceOf(Error);
          return Promise.resolve({ status: "retrying" });
        }
      }
    });

    expect(attempts).toBe(1);
    expect(result.deliveredCount).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it("keeps a slow delivery leased so another worker cannot reclaim and resend it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let releaseDelivery: (() => void) | undefined;
    let notifyDeliveryStarted: () => void = () => {};
    const deliveryStarted = new Promise<void>((resolve) => {
      notifyDeliveryStarted = resolve;
    });
    const leaseDurationMs = 30_000;
    let activeLease: { owner: string; token: string; expiresAt: Date } | null = null;
    let deliveryAttempts = 0;
    let renewals = 0;
    try {
      const dependencies = {
        listDueServers: () => Promise.resolve([]),
        claimOutbox: ({ owner, now: claimNow }: { owner: string; now: Date }) => {
          if (activeLease && activeLease.expiresAt.getTime() > claimNow.getTime()) {
            return Promise.resolve(null);
          }
          const token = `lease-${deliveryAttempts + 1}`;
          activeLease = {
            owner,
            token,
            expiresAt: new Date(claimNow.getTime() + leaseDurationMs)
          };
          return Promise.resolve({
            outboxId: "outbox-slow",
            alertId: "alert-slow",
            serverId: "srv-1",
            channelId: "channel-slow",
            serverName: "edge-1",
            teamId: "team-1",
            cooldownMinutes: 30,
            leaseOwner: owner,
            leaseToken: token,
            leaseDurationMs,
            transition: {
              metricKey: "cpu" as const,
              eventType: "server.metrics.hard" as const,
              transitionType: "transition" as const,
              previousState: "warning" as const,
              nextState: "hard" as const,
              measuredValue: 95,
              thresholdValue: 90,
              occurredAt: now
            }
          });
        },
        claimOutboxCooldown: () => Promise.resolve("deliver" as const),
        renewOutboxLease: ({
          delivery,
          now: renewalNow
        }: {
          delivery: { leaseOwner: string; leaseToken: string };
          now: Date;
        }) => {
          renewals += 1;
          if (
            !activeLease ||
            activeLease.owner !== delivery.leaseOwner ||
            activeLease.token !== delivery.leaseToken ||
            activeLease.expiresAt.getTime() <= renewalNow.getTime()
          ) {
            return Promise.resolve(false);
          }
          activeLease.expiresAt = new Date(renewalNow.getTime() + leaseDurationMs);
          return Promise.resolve(true);
        },
        markOutboxSent: ({
          delivery,
          now: sentNow
        }: {
          delivery: { leaseOwner: string; leaseToken: string };
          now: Date;
        }) => {
          if (
            activeLease &&
            activeLease.owner === delivery.leaseOwner &&
            activeLease.token === delivery.leaseToken &&
            activeLease.expiresAt.getTime() > sentNow.getTime()
          ) {
            activeLease = null;
            return Promise.resolve({ id: "outbox-slow" });
          }
          return Promise.resolve(null);
        }
      };
      const first = runServerMetricsMonitorCycle({
        clock: () => new Date(),
        outboxLimit: 1,
        owner: "replica-a",
        onTransition: () => {
          deliveryAttempts += 1;
          notifyDeliveryStarted();
          return new Promise<void>((resolve) => {
            releaseDelivery = resolve;
          });
        },
        dependencies
      });

      await deliveryStarted;
      expect(deliveryAttempts).toBe(1);
      await vi.advanceTimersByTimeAsync(30_001);

      const second = await runServerMetricsMonitorCycle({
        clock: () => new Date(),
        outboxLimit: 1,
        owner: "replica-b",
        onTransition: () => {
          deliveryAttempts += 1;
          return Promise.resolve();
        },
        dependencies
      });

      expect(renewals).toBeGreaterThanOrEqual(3);
      expect(second.deliveredCount).toBe(0);
      expect(deliveryAttempts).toBe(1);

      releaseDelivery?.();
      await expect(first).resolves.toMatchObject({ deliveredCount: 1, failures: [] });
    } finally {
      releaseDelivery?.();
      vi.useRealTimers();
    }
  });

  it("does not report delivery when the fenced sent update loses ownership", async () => {
    const result = await runServerMetricsMonitorCycle({
      clock: () => new Date(now),
      outboxLimit: 1,
      owner: "replica-a",
      onTransition: () => Promise.resolve(),
      dependencies: {
        listDueServers: () => Promise.resolve([]),
        claimOutbox: () =>
          Promise.resolve({
            outboxId: "outbox-lost",
            alertId: "alert-lost",
            serverId: "srv-1",
            channelId: "channel-lost",
            serverName: "edge-1",
            teamId: "team-1",
            cooldownMinutes: 30,
            leaseOwner: "replica-a",
            leaseToken: "lease-lost",
            leaseDurationMs: 30_000,
            transition: {
              metricKey: "cpu",
              eventType: "server.metrics.hard",
              transitionType: "transition",
              previousState: "warning",
              nextState: "hard",
              measuredValue: 95,
              thresholdValue: 90,
              occurredAt: now
            }
          }),
        claimOutboxCooldown: () => Promise.resolve("deliver" as const),
        markOutboxSent: () => Promise.resolve(null)
      }
    });

    expect(result.deliveredCount).toBe(0);
  });

  it("uses a fresh injected clock reading for each persisted and delivered lease decision", async () => {
    const timestamps = Array.from(
      { length: 7 },
      (_, index) => new Date(now.getTime() + (index + 1) * 1_000)
    );
    const clock = () => timestamps.shift() ?? new Date(now.getTime() + 60_000);
    const observed: Record<string, Date> = {};
    let pending = true;

    await runServerMetricsMonitorCycle({
      clock,
      outboxLimit: 1,
      onTransition: () => Promise.resolve(),
      dependencies: {
        listDueServers: ({ now: dueNow }) => {
          observed.due = dueNow;
          return Promise.resolve([candidate("srv-1")]);
        },
        claimCollection: ({ serverId, now: claimNow }) => {
          observed.collectionClaim = claimNow;
          return Promise.resolve(lease(serverId));
        },
        resolveTarget: () => Promise.resolve({ mode: "local" }),
        collectMetrics: () => Promise.resolve(metricSnapshot),
        persistCollection: (input) => {
          observed.persist = input.now;
          return Promise.resolve(input.transitions.length);
        },
        pruneSamples: (_serverId, _retentionDays, pruneNow) => {
          observed.prune = pruneNow;
          return Promise.resolve(0);
        },
        claimOutbox: ({ now: claimNow }) => {
          observed.outboxClaim = claimNow;
          if (!pending) return Promise.resolve(null);
          pending = false;
          return Promise.resolve({
            outboxId: "outbox-clock",
            alertId: "alert-clock",
            serverId: "srv-1",
            channelId: "channel-clock",
            serverName: "edge-1",
            teamId: "team-1",
            cooldownMinutes: 30,
            leaseOwner: "replica-a",
            leaseToken: "lease-clock",
            leaseDurationMs: 30_000,
            transition: {
              metricKey: "cpu",
              eventType: "server.metrics.hard",
              transitionType: "transition",
              previousState: "warning",
              nextState: "hard",
              measuredValue: 95,
              thresholdValue: 90,
              occurredAt: now
            }
          });
        },
        claimOutboxCooldown: ({ now: cooldownNow }) => {
          observed.cooldown = cooldownNow;
          return Promise.resolve("deliver" as const);
        },
        markOutboxSent: ({ now: sentNow }) => {
          observed.sent = sentNow;
          return Promise.resolve({ id: "outbox-clock" });
        },
        markOutboxFailure: () => Promise.resolve(null)
      }
    });

    expect(observed).toEqual({
      due: new Date(now.getTime() + 1_000),
      collectionClaim: new Date(now.getTime() + 2_000),
      persist: new Date(now.getTime() + 3_000),
      prune: new Date(now.getTime() + 4_000),
      outboxClaim: new Date(now.getTime() + 5_000),
      cooldown: new Date(now.getTime() + 6_000),
      sent: new Date(now.getTime() + 7_000)
    });
  });

  it("waits for an in-flight cycle when stopped instead of leaving a detached poll loop", async () => {
    let releaseCycle: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      void startServerMetricsMonitor({
        pollIntervalMs: 60_000,
        runCycle: () => {
          resolve();
          return new Promise((finish) => {
            releaseCycle = () =>
              finish({
                processedCount: 0,
                sampledCount: 0,
                unreachableCount: 0,
                alertCount: 0,
                deliveredCount: 0,
                suppressedCount: 0,
                transitions: [],
                failures: []
              });
          });
        }
      });
    });
    await started;
    let stopped = false;
    const stop = stopServerMetricsMonitor().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseCycle?.();
    await stop;
    expect(stopped).toBe(true);
  });
});
