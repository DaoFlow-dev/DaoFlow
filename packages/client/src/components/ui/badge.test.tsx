// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge", () => {
  afterEach(() => {
    cleanup();
  });

  it("applies dark-mode contrast classes for the destructive variant", () => {
    render(
      <Badge variant="destructive" data-testid="badge-destructive">
        Failed
      </Badge>
    );

    expect(screen.getByTestId("badge-destructive")).toHaveClass(
      "bg-destructive",
      "text-white",
      "dark:border-destructive/40",
      "dark:bg-destructive/20",
      "dark:text-red-200",
      "dark:hover:bg-destructive/30"
    );
  });
});
