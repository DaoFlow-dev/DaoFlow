// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";

describe("ProjectSettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a saving state on the save action", () => {
    render(
      <ProjectSettingsPanel
        editName="Demo"
        onEditName={vi.fn()}
        editDesc="Demo project"
        onEditDesc={vi.fn()}
        onSave={vi.fn()}
        onRequestDelete={vi.fn()}
        isSaving
        isDeletePending={false}
        saveDisabled
      />
    );

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("surfaces the provided error message and delete callback", () => {
    const onRequestDelete = vi.fn();

    render(
      <ProjectSettingsPanel
        editName="Demo"
        onEditName={vi.fn()}
        editDesc="Demo project"
        onEditDesc={vi.fn()}
        onSave={vi.fn()}
        onRequestDelete={onRequestDelete}
        isSaving={false}
        isDeletePending={false}
        saveDisabled={false}
        errorMessage="Could not update project."
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Project" }));

    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Could not update project.")).toBeVisible();
  });
});
