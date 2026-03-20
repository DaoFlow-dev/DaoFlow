import { describe, expect, test } from "bun:test";
import { buildServicePreviewTarget } from "./service-preview-target";

describe("buildServicePreviewTarget", () => {
  test("builds a pull-request preview target", () => {
    expect(
      buildServicePreviewTarget({
        previewBranch: "feature/login",
        previewPr: "42"
      })
    ).toEqual({
      preview: {
        target: "pull-request",
        branch: "feature/login",
        pullRequestNumber: 42,
        action: "deploy"
      }
    });
  });

  test("requires a selector when closing a preview", () => {
    expect(
      buildServicePreviewTarget({
        previewClose: true
      })
    ).toEqual({
      error: "--preview-close requires --preview-branch or --preview-pr."
    });
  });

  test("requires a branch for pull-request previews", () => {
    expect(
      buildServicePreviewTarget({
        previewPr: "42"
      })
    ).toEqual({
      error: "--preview-pr also requires --preview-branch."
    });
  });

  test("rejects non-positive pull-request identifiers", () => {
    expect(
      buildServicePreviewTarget({
        previewBranch: "feature/login",
        previewPr: "0"
      })
    ).toEqual({
      error: "--preview-pr must be a positive integer."
    });
  });
});
