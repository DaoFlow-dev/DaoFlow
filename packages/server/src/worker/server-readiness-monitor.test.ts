import { describe, expect, it } from "vitest";
import {
  resolveServerReadinessCycleLogEntry,
  resolveServerReadinessFailureState,
  resolveServerReadinessSleepMs
} from "./server-readiness-monitor";

describe("resolveServerReadinessSleepMs", () => {
  it("uses the configured interval when the last batch was not full", () => {
    expect(resolveServerReadinessSleepMs(3, 60_000, 8)).toBe(60_000);
  });

  it("drains due work quickly after a full batch", () => {
    expect(resolveServerReadinessSleepMs(8, 60_000, 8)).toBe(1_000);
  });
});

describe("resolveServerReadinessCycleLogEntry", () => {
  it("suppresses steady-state healthy cycle summaries", () => {
    expect(resolveServerReadinessCycleLogEntry(3, 0, false)).toBeNull();
  });

  it("warns when a cycle first enters degraded state", () => {
    expect(resolveServerReadinessCycleLogEntry(2, 1, false)).toEqual({
      level: "warn",
      message: "[server-readiness] Refresh cycle entered degraded state (1 failed, 2 succeeded)"
    });
  });

  it("suppresses duplicate degraded summaries while failures persist", () => {
    expect(resolveServerReadinessCycleLogEntry(1, 1, true)).toBeNull();
  });

  it("logs recovery when a clean cycle follows a degraded one", () => {
    expect(resolveServerReadinessCycleLogEntry(3, 0, true)).toEqual({
      level: "log",
      message: "[server-readiness] Refresh cycle recovered (3 server(s) refreshed cleanly)"
    });
  });

  it("waits for an actual clean refresh before logging recovery", () => {
    expect(resolveServerReadinessCycleLogEntry(0, 0, true)).toBeNull();
  });
});

describe("resolveServerReadinessFailureState", () => {
  it("enters degraded state when a cycle has failures", () => {
    expect(resolveServerReadinessFailureState(2, 1, false)).toBe(true);
  });

  it("preserves degraded state across empty cycles", () => {
    expect(resolveServerReadinessFailureState(0, 0, true)).toBe(true);
  });

  it("clears degraded state after a clean refresh cycle", () => {
    expect(resolveServerReadinessFailureState(3, 0, true)).toBe(false);
  });
});
