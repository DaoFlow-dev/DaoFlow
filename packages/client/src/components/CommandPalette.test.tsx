// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  function renderCommandPalette() {
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <CommandPalette />
      </MemoryRouter>
    );
  }

  it("announces the active command via aria-activedescendant during keyboard navigation", async () => {
    renderCommandPalette();

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = await screen.findByRole("combobox");

    expect(input).toHaveAttribute("aria-controls", "command-palette-listbox");
    expect(input).toHaveAttribute("aria-activedescendant", "command-palette-option-recent-/");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "command-palette-option-qa-create-project"
    );
    expect(screen.getByRole("option", { name: /Create Project/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("clears aria-activedescendant when the filtered result set is empty", async () => {
    renderCommandPalette();

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "no match here" } });

    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(screen.getByText("No results found.")).toBeVisible();
  });
});
