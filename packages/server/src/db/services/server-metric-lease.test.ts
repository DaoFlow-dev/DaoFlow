import { describe, expect, it } from "vitest";
import { isCurrentServerMetricCollectionLease } from "./server-metric-lease";

const now = new Date("2026-07-18T12:00:00.000Z");
const lease = {
  serverId: "srv-1",
  owner: "replica-a",
  token: "token-a",
  generation: 4,
  expiresAt: new Date(now.getTime() + 60_000)
};

describe("server metric collection lease", () => {
  it("accepts only the active generation and token, rejecting stale replica writers", () => {
    const row = {
      serverId: "srv-1",
      collectionGeneration: 4,
      collectionLeaseOwner: "replica-a",
      collectionLeaseToken: "token-a",
      collectionLeaseExpiresAt: new Date(now.getTime() + 60_000)
    };
    expect(isCurrentServerMetricCollectionLease(row, lease, now)).toBe(true);
    expect(
      isCurrentServerMetricCollectionLease({ ...row, collectionLeaseToken: "token-b" }, lease, now)
    ).toBe(false);
    expect(
      isCurrentServerMetricCollectionLease(
        { ...row, collectionGeneration: 5, collectionLeaseExpiresAt: new Date(now.getTime() - 1) },
        lease,
        now
      )
    ).toBe(false);
  });
});
