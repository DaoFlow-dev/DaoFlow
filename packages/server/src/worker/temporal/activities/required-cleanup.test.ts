import { describe, expect, it, vi } from "vitest";
import { runWithRequiredCleanup } from "./required-cleanup";

describe("required cleanup", () => {
  it("preserves both the operation and cleanup failures", async () => {
    const operationError = new Error("archive failed");
    const cleanupError = new Error("cleanup failed");
    const promise = runWithRequiredCleanup(
      () => Promise.reject(operationError),
      () => Promise.reject(cleanupError),
      "Archive and cleanup failed."
    );

    await expect(promise).rejects.toMatchObject({
      message: "Archive and cleanup failed. Operation: archive failed Cleanup: cleanup failed",
      errors: [operationError, cleanupError]
    });
  });

  it("returns the operation result after successful cleanup", async () => {
    const cleanup = vi.fn(() => Promise.resolve());
    await expect(
      runWithRequiredCleanup(() => Promise.resolve("complete"), cleanup, "unused")
    ).resolves.toBe("complete");
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
