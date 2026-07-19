import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REMOTE_TRANSFER_HEARTBEAT_INTERVAL_MS,
  remoteTransferActivityTestHooks
} from "./remote-transfer-activity";

afterEach(() => vi.useRealTimers());

describe("remote transfer activity execution", () => {
  it("heartbeats while passing Temporal cancellation to long-running work", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn();
    const controller = new AbortController();
    let finish: (() => void) | undefined;
    const result = remoteTransferActivityTestHooks.runWithRemoteTransferActivity(
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
    await vi.advanceTimersByTimeAsync(REMOTE_TRANSFER_HEARTBEAT_INTERVAL_MS * 2);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    finish?.();
    await expect(result).resolves.toBe("complete");
  });

  it("does not start remote work after cancellation", async () => {
    const controller = new AbortController();
    const cancellation = new Error("operator cancelled transfer");
    const operation = vi.fn(() => Promise.resolve("unexpected"));
    controller.abort(cancellation);

    await expect(
      remoteTransferActivityTestHooks.runWithRemoteTransferActivity(operation, {
        heartbeat: vi.fn(),
        cancellationSignal: controller.signal
      })
    ).rejects.toBe(cancellation);
    expect(operation).not.toHaveBeenCalled();
  });
});
