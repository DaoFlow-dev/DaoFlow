// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServerReadinessIndicator } from "./ServerReadinessIndicator";

describe("ServerReadinessIndicator", () => {
  it.each([
    ["ready", "Ready", "Connected and ready for deployments"],
    ["healthy", "Ready", "Connected and ready for deployments"],
    ["attention", "Attention", "Needs review before the next rollout"],
    ["blocked", "Blocked", "Connectivity is blocked for this host"]
  ])("renders %s as an explicit status chip", (readinessStatus, label, detail) => {
    render(
      <ServerReadinessIndicator
        readinessStatus={readinessStatus}
        dataTestId={`server-status-${readinessStatus}`}
      />
    );

    const chip = screen.getByTestId(`server-status-${readinessStatus}`);

    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute("role", "status");
    expect(chip).toHaveAttribute("aria-label", `Server status: ${label}. ${detail}.`);
  });

  it("falls back to attention semantics for degraded readiness", () => {
    render(
      <ServerReadinessIndicator readinessStatus="degraded" dataTestId="server-status-degraded" />
    );

    expect(screen.getByTestId("server-status-degraded")).toHaveTextContent("Attention");
  });
});
