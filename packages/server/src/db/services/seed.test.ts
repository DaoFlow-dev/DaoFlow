import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  transactionMock,
  seedUsersMock,
  seedInfrastructureMock,
  seedDeploymentsMock,
  seedObservabilityMock
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  seedUsersMock: vi.fn(),
  seedInfrastructureMock: vi.fn(),
  seedDeploymentsMock: vi.fn(),
  seedObservabilityMock: vi.fn()
}));

vi.mock("../connection", () => ({
  db: {
    transaction: transactionMock
  }
}));

vi.mock("./seed/seed-users", () => ({
  seedUsers: seedUsersMock
}));

vi.mock("./seed/seed-infrastructure", () => ({
  seedInfrastructure: seedInfrastructureMock
}));

vi.mock("./seed/seed-deployments", () => ({
  seedDeployments: seedDeploymentsMock
}));

vi.mock("./seed/seed-observability", () => ({
  seedObservability: seedObservabilityMock
}));

async function loadSeedModule() {
  return import("./seed");
}

describe("control-plane seed state", () => {
  beforeEach(() => {
    transactionMock.mockReset();
    seedUsersMock.mockReset();
    seedInfrastructureMock.mockReset();
    seedDeploymentsMock.mockReset();
    seedObservabilityMock.mockReset();

    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      await callback({ tx: "mock" });
    });
  });

  it("rejects when seeding fails instead of silently continuing", async () => {
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedUsersMock.mockRejectedValueOnce(new Error("seed failed"));

    const seed = await loadSeedModule();

    await expect(seed.ensureControlPlaneReady()).rejects.toThrow("seed failed");
    expect(warnSpy).toHaveBeenCalledWith(
      "[seed] Control-plane seed failed (will retry on next request):",
      "seed failed"
    );
  });

  it("retries seeding after a failed attempt resets the cached promise", async () => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    seedUsersMock
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(undefined);
    seedInfrastructureMock.mockResolvedValue(undefined);
    seedDeploymentsMock.mockResolvedValue(undefined);
    seedObservabilityMock.mockResolvedValue(undefined);

    const seed = await loadSeedModule();

    await expect(seed.ensureControlPlaneReady()).rejects.toThrow("temporary failure");
    await expect(seed.ensureControlPlaneReady()).resolves.toBeUndefined();

    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(seedUsersMock).toHaveBeenCalledTimes(2);
  });
});
