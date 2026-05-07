import { describe, expect, it } from "vitest";
import { resolveDevelopmentTaskWatchdogPollIntervalMs } from "./development-task-watchdog-monitor";

describe("development task watchdog monitor", () => {
  it("guards the poll interval override", () => {
    expect(resolveDevelopmentTaskWatchdogPollIntervalMs("bad-value")).toBe(30_000);
    expect(resolveDevelopmentTaskWatchdogPollIntervalMs("1000")).toBe(30_000);
    expect(resolveDevelopmentTaskWatchdogPollIntervalMs("10000")).toBe(10_000);
  });
});
