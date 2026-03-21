// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServerCheckCard } from "./ServersPage";

describe("ServerCheckCard", () => {
  it("shows the registered target kind for inspection", () => {
    render(
      <ServerCheckCard
        check={{
          serverId: "srv_swarm_1",
          serverName: "swarm-mgr-1",
          serverHost: "10.0.0.25",
          targetKind: "docker-swarm-manager",
          sshPort: 22,
          readinessStatus: "attention",
          sshReachable: true,
          dockerReachable: true,
          composeReachable: true,
          checkedAt: "2026-03-21T00:00:00.000Z",
          latencyMs: 27,
          issues: [],
          recommendedActions: []
        }}
      />
    );

    expect(screen.getByTestId("server-target-kind-srv_swarm_1")).toHaveTextContent(
      "Target docker-swarm-manager"
    );
    expect(screen.getByText(/10\.0\.0\.25 · docker-swarm-manager · SSH 22/)).toBeVisible();
  });
});
