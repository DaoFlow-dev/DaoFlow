import { describe, expect, it } from "vitest";
import { resolveDeploymentWatchdogPollIntervalMs } from "./deployment-watchdog-monitor";

describe("resolveDeploymentWatchdogPollIntervalMs", () => {
  it("falls back to the default when the override is invalid", () => {
    expect(resolveDeploymentWatchdogPollIntervalMs("bad-value")).toBe(15_000);
    expect(resolveDeploymentWatchdogPollIntervalMs("500")).toBe(15_000);
  });

  it("accepts valid millisecond overrides", () => {
    expect(resolveDeploymentWatchdogPollIntervalMs("2000")).toBe(2_000);
  });
});
