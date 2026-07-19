import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTROL_PLANE_RECOVERY_HEARTBEAT_INTERVAL_MS,
  controlPlaneRecoveryHeartbeatTestHooks
} from "./control-plane-recovery-heartbeat";

afterEach(() => {
  vi.useRealTimers();
});

describe("control-plane recovery activity execution", () => {
  it("heartbeats immediately and every 30 seconds while long work is active", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn();
    const controller = new AbortController();
    let finish: (() => void) | undefined;
    const result = controlPlaneRecoveryHeartbeatTestHooks.runWithRecoveryActivityHeartbeat(
      async (signal) => {
        expect(signal).toBe(controller.signal);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return "complete";
      },
      { heartbeat, cancellationSignal: controller.signal }
    );

    expect(heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CONTROL_PLANE_RECOVERY_HEARTBEAT_INTERVAL_MS * 2);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    finish?.();
    await expect(result).resolves.toBe("complete");
    await vi.advanceTimersByTimeAsync(CONTROL_PLANE_RECOVERY_HEARTBEAT_INTERVAL_MS * 2);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it("does not begin recovery work after Temporal has cancelled the activity", async () => {
    const heartbeat = vi.fn();
    const controller = new AbortController();
    const cancellation = new Error("operator cancelled recovery");
    const operation = vi.fn(() => Promise.resolve("should not run"));
    controller.abort(cancellation);

    await expect(
      controlPlaneRecoveryHeartbeatTestHooks.runWithRecoveryActivityHeartbeat(operation, {
        heartbeat,
        cancellationSignal: controller.signal
      })
    ).rejects.toBe(cancellation);
    expect(operation).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
  });
});
