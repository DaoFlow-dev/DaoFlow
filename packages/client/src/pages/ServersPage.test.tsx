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
          swarmTopology: {
            clusterId: "swarm-srv_swarm_1",
            clusterName: "swarm-mgr-1",
            source: "registration",
            defaultNamespace: null,
            summary: {
              nodeCount: 2,
              managerCount: 1,
              workerCount: 1,
              activeNodeCount: 2,
              reachableNodeCount: 1
            },
            nodes: [
              {
                id: "srv_swarm_1-manager",
                name: "swarm-mgr-1",
                host: "10.0.0.25",
                role: "manager",
                availability: "active",
                reachability: "reachable",
                managerStatus: "leader"
              },
              {
                id: "srv_swarm_1-worker-1",
                name: "swarm-worker-1",
                host: "10.0.0.26",
                role: "worker",
                availability: "active",
                reachability: "unknown",
                managerStatus: "none"
              }
            ]
          },
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
    expect(screen.getByTestId("swarm-topology-srv_swarm_1")).toHaveTextContent("1 worker");
    expect(
      screen.getByTestId("swarm-topology-node-srv_swarm_1-srv_swarm_1-worker-1")
    ).toHaveTextContent("swarm-worker-1 · worker · active · unknown");
  });
});
