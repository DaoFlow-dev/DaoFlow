import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  artifactEvents: [] as Array<unknown[]>,
  assertPinnedRemoteMarker: vi.fn(),
  loadRealInfraConfig: vi.fn(),
  realInfraConfigSummary: vi.fn(),
  sensitiveConfigValues: vi.fn()
}));

vi.mock("./artifacts", () => ({
  RealInfraArtifacts: class {
    constructor(...args: unknown[]) {
      mocks.artifactEvents.push(["constructor", ...args]);
    }

    async prepare() {
      mocks.artifactEvents.push(["prepare"]);
    }

    async outcome(...args: unknown[]) {
      mocks.artifactEvents.push(["outcome", ...args]);
    }

    async result(...args: unknown[]) {
      mocks.artifactEvents.push(["result", ...args]);
    }

    async cleanup(...args: unknown[]) {
      mocks.artifactEvents.push(["cleanup", ...args]);
    }
  }
}));
vi.mock("./config", () => ({
  loadRealInfraConfig: mocks.loadRealInfraConfig,
  realInfraConfigSummary: mocks.realInfraConfigSummary,
  sensitiveConfigValues: mocks.sensitiveConfigValues
}));
vi.mock("./ssh", () => ({ assertPinnedRemoteMarker: mocks.assertPinnedRemoteMarker }));

import { runRealInfraPreflight } from "./preflight";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.artifactEvents.splice(0);
});

afterEach(() => vi.restoreAllMocks());

describe("real-infrastructure preflight", () => {
  it("records configuration failures as configuration failures", async () => {
    mocks.loadRealInfraConfig.mockImplementation(() => {
      throw new Error("missing real-infrastructure settings");
    });

    await expect(runRealInfraPreflight()).rejects.toThrow("missing real-infrastructure settings");

    expect(mocks.artifactEvents).toContainEqual([
      "outcome",
      "configuration",
      "failed",
      { reason: "missing real-infrastructure settings" }
    ]);
    expect(mocks.artifactEvents).not.toContainEqual([
      "outcome",
      "pinned-ssh-marker-preflight",
      "failed",
      expect.anything()
    ]);
    expect(mocks.assertPinnedRemoteMarker).not.toHaveBeenCalled();
  });
});
