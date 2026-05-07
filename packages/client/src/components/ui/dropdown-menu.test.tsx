// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "./dropdown-menu";

describe("DropdownMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("allows a standalone label inside open menu content", () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Signed in as owner@example.com</DropdownMenuLabel>
          <DropdownMenuItem>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    expect(screen.getByText("Signed in as owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out", hidden: true })).toBeInTheDocument();
  });
});
