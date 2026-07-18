import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamBodyToFile } from "./stream-to-file";

const encoder = new TextEncoder();

describe("streamBodyToFile", () => {
  let stageDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    stageDir = mkdtempSync(join(tmpdir(), "daoflow-stream-to-file-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(stageDir, { recursive: true, force: true });
  });

  it("renews asynchronously while a delayed request stream is active", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        streamController.enqueue(encoder.encode("first"));
      }
    });
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const destination = join(stageDir, "upload.tar");

    const upload = streamBodyToFile(body, destination, {
      heartbeat,
      heartbeatIntervalMs: 5
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    controller?.enqueue(encoder.encode("-second"));
    controller?.close();
    await upload;

    expect(readFileSync(destination, "utf8")).toBe("first-second");
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("aborts the request stream when reservation renewal fails", async () => {
    let cancelReason: unknown;
    const renewalError = new Error("reservation expired");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("partial"));
      },
      cancel(reason) {
        cancelReason = reason;
      }
    });
    const heartbeat = vi.fn().mockRejectedValue(renewalError);
    const destination = join(stageDir, "upload.tar");
    const upload = streamBodyToFile(body, destination, {
      heartbeat,
      heartbeatIntervalMs: 5
    });

    const rejection = expect(upload).rejects.toThrow("reservation expired");
    await vi.advanceTimersByTimeAsync(5);
    await rejection;

    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(cancelReason).toBe(renewalError);
  });

  it("writes large uploads completely while honoring disk backpressure", async () => {
    const chunks = [
      new Uint8Array(256 * 1024).fill(1),
      new Uint8Array(256 * 1024).fill(2),
      new Uint8Array(256 * 1024).fill(3),
      new Uint8Array(256 * 1024).fill(4)
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    });
    const destination = join(stageDir, "large-upload.tar");

    await streamBodyToFile(body, destination);

    const contents = readFileSync(destination);
    expect(contents).toHaveLength(1024 * 1024);
    expect(contents[0]).toBe(1);
    expect(contents[256 * 1024]).toBe(2);
    expect(contents[512 * 1024]).toBe(3);
    expect(contents[768 * 1024]).toBe(4);
  });
});
