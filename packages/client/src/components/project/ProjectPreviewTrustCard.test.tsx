// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickSelectOption } from "@/test/select-option";
import { ProjectPreviewTrustCard } from "./ProjectPreviewTrustCard";

describe("ProjectPreviewTrustCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("defaults to manual approval and can disable pull-request previews", () => {
    const onSave = vi.fn();
    render(<ProjectPreviewTrustCard previewPolicyRevision={3} onSave={onSave} />);

    expect(screen.getByTestId("project-preview-policy-status")).toHaveTextContent(
      "Policy revision 3"
    );
    expect(screen.getByText(/Fork previews are unavailable/)).toBeVisible();
    expect(screen.getByTestId("project-preview-policy-save")).toBeDisabled();

    fireEvent.click(screen.getByTestId("project-preview-policy"));
    clickSelectOption("Disabled");
    fireEvent.click(screen.getByTestId("project-preview-policy-save"));

    expect(onSave).toHaveBeenCalledWith("disabled");
  });
});
