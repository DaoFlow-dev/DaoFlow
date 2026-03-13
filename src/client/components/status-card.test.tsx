// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusCard } from "./status-card";

describe("StatusCard", () => {
  it("renders the supplied items", () => {
    render(
      <StatusCard title="Agent API lanes" items={["read APIs", "planning APIs", "command APIs"]} />
    );

    expect(screen.getByRole("heading", { name: "Agent API lanes" })).toBeVisible();
    expect(screen.getByText("read APIs")).toBeVisible();
    expect(screen.getByText("planning APIs")).toBeVisible();
    expect(screen.getByText("command APIs")).toBeVisible();
  });
});
