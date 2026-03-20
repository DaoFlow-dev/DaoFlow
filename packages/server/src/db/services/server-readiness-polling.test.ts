import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { servers } from "../schema/servers";
import { resetTestDatabase } from "../../test-db";

vi.mock("./server-readiness", () => ({
  verifyServerReadiness: vi.fn((server: typeof servers.$inferSelect) => server)
}));

import {
  listServersDueForReadinessCheck,
  pollServerReadinessOnce
} from "./server-readiness-polling";
import { verifyServerReadiness } from "./server-readiness";

const verifyServerReadinessMock = verifyServerReadiness as unknown as {
  mockClear: () => void;
  mockImplementation: (
    implementation: (server: typeof servers.$inferSelect) => typeof servers.$inferSelect
  ) => void;
  mock: {
    calls: Array<[typeof servers.$inferSelect]>;
  };
};

function createUniqueTestSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function createUniqueHost(label: string, suffix: string) {
  return `${label}-${suffix}.test`;
}

describe("server readiness polling", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    verifyServerReadinessMock.mockClear();
  });

  it("selects only unchecked and stale servers for recurring readiness verification", async () => {
    const referenceTime = new Date("2026-03-20T22:00:00.000Z");
    const suffix = createUniqueTestSuffix();
    const neverCheckedId = `srv_poll_never_${suffix}`.slice(0, 32);
    const staleId = `srv_poll_stale_${suffix}`.slice(0, 32);
    const freshId = `srv_poll_fresh_${suffix}`.slice(0, 32);

    await db.insert(servers).values([
      {
        id: neverCheckedId,
        name: `never-checked-${suffix}`,
        host: createUniqueHost("never-checked", suffix),
        sshPort: 22,
        kind: "docker-engine",
        status: "pending verification",
        metadata: {},
        updatedAt: referenceTime
      },
      {
        id: staleId,
        name: `stale-check-${suffix}`,
        host: createUniqueHost("stale-check", suffix),
        sshPort: 22,
        kind: "docker-engine",
        status: "attention",
        metadata: {},
        lastCheckedAt: new Date(referenceTime.getTime() - 5 * 60_000),
        updatedAt: referenceTime
      },
      {
        id: freshId,
        name: `fresh-check-${suffix}`,
        host: createUniqueHost("fresh-check", suffix),
        sshPort: 22,
        kind: "docker-engine",
        status: "ready",
        metadata: {},
        lastCheckedAt: new Date(referenceTime.getTime() - 15_000),
        updatedAt: referenceTime
      }
    ]);

    const dueServers = await listServersDueForReadinessCheck({
      intervalMs: 60_000,
      limit: 1_000,
      referenceTime
    });

    const dueServerIds = dueServers.map((server) => server.id);
    expect(dueServerIds).toEqual(expect.arrayContaining([neverCheckedId, staleId]));
    expect(dueServerIds).not.toContain(freshId);
  });

  it("polls only due servers and reports per-server verification failures", async () => {
    const referenceTime = new Date("2026-03-20T22:00:00.000Z");
    const suffix = createUniqueTestSuffix();
    const failId = `srv_poll_fail_${suffix}`.slice(0, 32);
    const okId = `srv_poll_ok_${suffix}`.slice(0, 32);
    const skipId = `srv_poll_skip_${suffix}`.slice(0, 32);

    await db.insert(servers).values([
      {
        id: failId,
        name: `poll-fail-${suffix}`,
        host: createUniqueHost("poll-fail", suffix),
        sshPort: 22,
        kind: "docker-engine",
        status: "attention",
        metadata: {},
        lastCheckedAt: new Date(referenceTime.getTime() - 5 * 60_000),
        updatedAt: referenceTime
      },
      {
        id: okId,
        name: `poll-ok-${suffix}`,
        host: createUniqueHost("poll-ok", suffix),
        sshPort: 22,
        kind: "docker-engine",
        status: "attention",
        metadata: {},
        lastCheckedAt: new Date(referenceTime.getTime() - 5 * 60_000),
        updatedAt: referenceTime
      },
      {
        id: skipId,
        name: `poll-skip-${suffix}`,
        host: createUniqueHost("poll-skip", suffix),
        sshPort: 22,
        kind: "docker-engine",
        status: "ready",
        metadata: {},
        lastCheckedAt: new Date(referenceTime.getTime() - 10_000),
        updatedAt: referenceTime
      }
    ]);

    verifyServerReadinessMock.mockImplementation((server) => {
      if (server.id === failId) {
        throw new Error("simulated readiness failure");
      }
      return server;
    });

    const result = await pollServerReadinessOnce({
      intervalMs: 60_000,
      limit: 1_000,
      referenceTime
    });

    const checkedIds = verifyServerReadinessMock.mock.calls.map(([server]) => server.id);

    expect(checkedIds).toEqual(expect.arrayContaining([failId, okId]));
    expect(checkedIds).not.toContain(skipId);
    expect(result.checkedServerIds).toContain(okId);
    expect(result.checkedServerIds).not.toContain(skipId);
    expect(result.failedCount).toBeGreaterThanOrEqual(1);
  });
});
