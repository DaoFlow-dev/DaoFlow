import { describe, expect, it } from "vitest";
import {
  nodeFromDocker,
  parseDockerJsonLines,
  planSwarmNodeAvailability,
  planSwarmServiceScale
} from "./swarm-management";

describe("swarm management helpers", () => {
  it("normalizes docker node JSON into topology nodes", () => {
    const [node] = parseDockerJsonLines(
      JSON.stringify({
        ID: "node_1*",
        Hostname: "manager-a",
        Status: "Ready",
        Availability: "Drain",
        ManagerStatus: "Leader"
      })
    ).map(nodeFromDocker);

    expect(node).toEqual({
      id: "node_1",
      name: "manager-a",
      host: null,
      role: "manager",
      availability: "drain",
      reachability: "reachable",
      managerStatus: "leader"
    });
  });

  it("builds dry-run plans for node availability and service scale operations", () => {
    expect(planSwarmNodeAvailability({ node: "worker-a", availability: "pause" })).toEqual({
      dryRun: true,
      command: "docker node update --availability pause worker-a",
      summary: "Would set Swarm node worker-a availability to pause."
    });
    expect(planSwarmServiceScale({ service: "demo_web", replicas: 3 })).toEqual({
      dryRun: true,
      command: "docker service scale demo_web=3",
      summary: "Would scale Swarm service demo_web to 3 replicas."
    });
  });
});
