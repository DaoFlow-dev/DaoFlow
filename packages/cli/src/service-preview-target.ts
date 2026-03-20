export interface ServicePreviewTarget {
  target: "branch" | "pull-request";
  branch: string;
  pullRequestNumber?: number;
  action?: "deploy" | "destroy";
}

export interface ServicePreviewTargetOptions {
  previewBranch?: string;
  previewPr?: string;
  previewClose?: boolean;
}

export function buildServicePreviewTarget(options: ServicePreviewTargetOptions): {
  preview?: ServicePreviewTarget;
  error?: string;
} {
  const hasPreviewSelector = Boolean(options.previewBranch || options.previewPr);

  if (!hasPreviewSelector) {
    if (options.previewClose) {
      return {
        error: "--preview-close requires --preview-branch or --preview-pr."
      };
    }

    return {};
  }

  if (options.previewPr && !options.previewBranch) {
    return {
      error: "--preview-pr also requires --preview-branch."
    };
  }

  const pullRequestNumber =
    typeof options.previewPr === "string" ? Number(options.previewPr) : undefined;
  if (pullRequestNumber !== undefined && !Number.isInteger(pullRequestNumber)) {
    return {
      error: "--preview-pr must be a positive integer."
    };
  }
  if (pullRequestNumber !== undefined && pullRequestNumber < 1) {
    return {
      error: "--preview-pr must be a positive integer."
    };
  }

  return {
    preview: {
      target: pullRequestNumber !== undefined ? "pull-request" : "branch",
      branch: options.previewBranch ?? "",
      pullRequestNumber,
      action: options.previewClose ? "destroy" : "deploy"
    }
  };
}
