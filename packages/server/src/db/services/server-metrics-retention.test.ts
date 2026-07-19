import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditEntries } from "../schema/audit";
import { deployments } from "../schema/deployments";
import { serverMetrics } from "../schema/server-metrics";

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  where: vi.fn(),
  returning: vi.fn()
}));

vi.mock("../connection", () => ({
  db: {
    delete: mocks.delete
  }
}));

import { pruneServerMetricSamples } from "./server-metrics";

describe("server metric retention", () => {
  beforeEach(() => {
    mocks.returning.mockResolvedValue([{ id: "metric-old" }]);
    mocks.where.mockReturnValue({ returning: mocks.returning });
    mocks.delete.mockReturnValue({ where: mocks.where });
    vi.clearAllMocks();
    mocks.returning.mockResolvedValue([{ id: "metric-old" }]);
    mocks.where.mockReturnValue({ returning: mocks.returning });
    mocks.delete.mockReturnValue({ where: mocks.where });
  });

  it("deletes only server metric samples within the requested server retention scope", async () => {
    await expect(
      pruneServerMetricSamples("srv-1", 7, new Date("2026-07-18T12:00:00.000Z"))
    ).resolves.toBe(1);

    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledWith(serverMetrics);
    expect(mocks.delete).not.toHaveBeenCalledWith(auditEntries);
    expect(mocks.delete).not.toHaveBeenCalledWith(deployments);
  });
});
