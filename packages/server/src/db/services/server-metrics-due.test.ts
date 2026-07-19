import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  whereCalled: false,
  rows: [] as Array<Record<string, unknown>>
}));

vi.mock("../connection", () => ({ db: { select: mocks.select } }));

import { listServersDueForMetricCollection } from "./server-metrics";

describe("server metric due selection", () => {
  beforeEach(() => {
    mocks.whereCalled = false;
    mocks.select.mockImplementation(() => {
      const query = {
        from: () => query,
        leftJoin: () => query,
        where: () => {
          mocks.whereCalled = true;
          return query;
        },
        orderBy: () => query,
        limit: () => {
          expect(mocks.whereCalled).toBe(true);
          return Promise.resolve(mocks.rows);
        }
      };
      return query;
    });
  });

  it("applies the SQL due predicate before limiting a mixed set larger than 100", async () => {
    const mixedServers = Array.from({ length: 120 }, (_, index) => ({
      id: `srv-${index + 1}`,
      due: index >= 100
    }));
    mocks.rows = mixedServers
      .filter((server) => server.due)
      .map((server) => ({
        server: { id: server.id, name: server.id, teamId: "team-1" },
        policy: null,
        state: null
      }));

    const due = await listServersDueForMetricCollection({
      now: new Date("2026-07-18T12:00:00.000Z"),
      limit: 100
    });

    expect(due).toHaveLength(20);
    expect(due.map((candidate) => candidate.server.id)).toEqual(
      mixedServers.slice(100).map((server) => server.id)
    );
    expect(mocks.select).toHaveBeenCalledOnce();
  });
});
