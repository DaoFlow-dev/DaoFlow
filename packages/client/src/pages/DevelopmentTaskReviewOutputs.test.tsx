// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevelopmentTaskReviewOutputs } from "./DevelopmentTaskReviewOutputs";

const { clipboardWriteTextMock } = vi.hoisted(() => ({
  clipboardWriteTextMock: vi.fn()
}));

describe("DevelopmentTaskReviewOutputs", () => {
  beforeEach(() => {
    clipboardWriteTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("copies review artifact and log paths for handoff", async () => {
    render(
      <DevelopmentTaskReviewOutputs
        latestRun={{
          metadata: {
            codexExecution: {
              logPath: "/runner/work/drun_1/logs/codex-exec.jsonl"
            },
            validation: {
              logPath: "/runner/work/drun_1/logs/validation.jsonl"
            },
            pullRequest: {
              logPath: "/runner/work/drun_1/logs/pull-request.jsonl",
              reviewArtifacts: {
                diffStatPath: "/runner/work/drun_1/artifacts/diff-stat.txt",
                changedFilesPath: "/runner/work/drun_1/artifacts/changed-files.json"
              }
            }
          }
        }}
      />
    );

    fireEvent.click(screen.getByTestId("development-task-copy-diff-stat"));
    fireEvent.click(screen.getByTestId("development-task-copy-changed-files"));
    fireEvent.click(screen.getByTestId("development-task-copy-codex-log"));
    fireEvent.click(screen.getByTestId("development-task-copy-validation-log"));
    fireEvent.click(screen.getByTestId("development-task-copy-review-handoff-log"));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "/runner/work/drun_1/artifacts/diff-stat.txt"
      );
    });
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      "/runner/work/drun_1/artifacts/changed-files.json"
    );
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      "/runner/work/drun_1/logs/codex-exec.jsonl"
    );
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      "/runner/work/drun_1/logs/validation.jsonl"
    );
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      "/runner/work/drun_1/logs/pull-request.jsonl"
    );
  });

  it("shows retry feedback when clipboard access fails", async () => {
    clipboardWriteTextMock.mockRejectedValueOnce(new Error("denied"));

    render(
      <DevelopmentTaskReviewOutputs
        latestRun={{
          metadata: {
            pullRequest: {
              reviewArtifacts: {
                diffStatPath: "/runner/work/drun_1/artifacts/diff-stat.txt"
              }
            }
          }
        }}
      />
    );

    fireEvent.click(screen.getByTestId("development-task-copy-diff-stat"));

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows retry feedback when clipboard access is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });

    render(
      <DevelopmentTaskReviewOutputs
        latestRun={{
          metadata: {
            pullRequest: {
              reviewArtifacts: {
                diffStatPath: "/runner/work/drun_1/artifacts/diff-stat.txt"
              }
            }
          }
        }}
      />
    );

    fireEvent.click(screen.getByTestId("development-task-copy-diff-stat"));

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
  });
});
