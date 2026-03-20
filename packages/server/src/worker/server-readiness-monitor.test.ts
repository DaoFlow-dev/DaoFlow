import { describe, expect, it } from "vitest";
import { resolveServerReadinessSleepMs } from "./server-readiness-monitor";

describe("resolveServerReadinessSleepMs", () => {
  it("uses the configured interval when the last batch was not full", () => {
    expect(resolveServerReadinessSleepMs(3, 60_000, 8)).toBe(60_000);
  });

  it("drains due work quickly after a full batch", () => {
    expect(resolveServerReadinessSleepMs(8, 60_000, 8)).toBe(1_000);
  });
});
