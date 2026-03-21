import { describe, expect, it } from "vitest";
import {
  assessSwarmStackHealth,
  parseSwarmServiceLsOutput,
  parseSwarmTaskPsOutput
} from "./swarm-health";

describe("swarm health", () => {
  it("parses docker stack services and tasks JSON lines", () => {
    const services = parseSwarmServiceLsOutput(
      [
        JSON.stringify({
          ID: "svc_web",
          Name: "demo_web",
          Mode: "replicated",
          Replicas: "1/1",
          Image: "nginx:alpine",
          Ports: "*:80->80/tcp"
        })
      ].join("\n")
    );
    const tasks = parseSwarmTaskPsOutput(
      [
        JSON.stringify({
          ID: "task_web_1",
          Name: "demo_web.1",
          Image: "nginx:alpine",
          Node: "manager-1",
          DesiredState: "Running",
          CurrentState: "Running 4 seconds ago",
          Error: "",
          Ports: ""
        })
      ].join("\n")
    );

    expect(services).toEqual([
      {
        id: "svc_web",
        name: "demo_web",
        mode: "replicated",
        replicas: "1/1",
        image: "nginx:alpine",
        ports: "*:80->80/tcp"
      }
    ]);
    expect(tasks[0]?.name).toBe("demo_web.1");
    expect(tasks[0]?.currentState).toContain("Running");
  });

  it("treats under-replicated services as pending", () => {
    const result = assessSwarmStackHealth(
      [
        {
          id: "svc_web",
          name: "demo_web",
          mode: "replicated",
          replicas: "0/1",
          image: "nginx:alpine",
          ports: null
        }
      ],
      [],
      "swarm stack demo"
    );

    expect(result.kind).toBe("pending");
    expect(result.summary).toContain("0/1");
  });

  it("fails when a desired running task is rejected", () => {
    const result = assessSwarmStackHealth(
      [
        {
          id: "svc_web",
          name: "demo_web",
          mode: "replicated",
          replicas: "0/1",
          image: "nginx:alpine",
          ports: null
        }
      ],
      [
        {
          id: "task_web_1",
          name: "demo_web.1",
          image: "nginx:alpine",
          node: "manager-1",
          desiredState: "Running",
          currentState: "Rejected 2 seconds ago",
          error: "no suitable node",
          ports: null
        }
      ],
      "swarm stack demo"
    );

    expect(result.kind).toBe("failed");
    expect(result.summary).toContain("Rejected");
    expect(result.summary).toContain("no suitable node");
  });
});
