import { describe, expect, it } from "vitest";
import {
  decideServerMetricOutboxCooldown,
  resolveServerMetricOutboxFailure
} from "./server-metric-outbox-delivery";

const now = new Date("2026-07-18T12:00:00.000Z");
const retryConfig = {
  leaseDurationMs: 30_000,
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 4_000
};

describe("server metric outbox delivery decisions", () => {
  it("durably suppresses only a repeated matching metric/event within cooldown", () => {
    expect(
      decideServerMetricOutboxCooldown({
        now,
        cooldownMinutes: 30,
        lastDeliveredAt: new Date(now.getTime() - 60_000),
        activeLeaseToken: null,
        activeLeaseExpiresAt: null,
        deliveryLeaseToken: "lease-2"
      })
    ).toBe("suppressed");
    expect(
      decideServerMetricOutboxCooldown({
        now,
        cooldownMinutes: 30,
        lastDeliveredAt: new Date(now.getTime() - 60_000),
        activeLeaseToken: null,
        activeLeaseExpiresAt: null,
        deliveryLeaseToken: "lease-hard"
      })
    ).toBe("suppressed");
  });

  it("retries with a bounded exponential delay and preserves terminal failure evidence", () => {
    const retry = resolveServerMetricOutboxFailure({
      attemptCount: 2,
      maxAttempts: 3,
      now,
      error: new Error("temporary sender failure"),
      retryConfig
    });
    expect(retry).toMatchObject({ status: "retrying", lastError: "temporary sender failure" });
    expect(retry.nextAttemptAt).toEqual(new Date(now.getTime() + 2_000));

    const terminal = resolveServerMetricOutboxFailure({
      attemptCount: 3,
      maxAttempts: 3,
      now,
      error: new Error("permanent sender failure"),
      retryConfig
    });
    expect(terminal).toMatchObject({
      status: "terminal-failure",
      lastError: "permanent sender failure",
      terminalFailedAt: now,
      nextAttemptAt: now
    });
  });
});
