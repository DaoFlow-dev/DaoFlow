import { describe, expect, it } from "vitest";
import {
  assessComposeHealth,
  parseComposePsOutput,
  type ComposeContainerStatus
} from "./compose-health";

describe("parseComposePsOutput", () => {
  it("parses newline-delimited compose ps JSON output", () => {
    const statuses = parseComposePsOutput(
      [
        JSON.stringify({
          Service: "api",
          Name: "demo-api-1",
          State: "running",
          Status: "Up 3 seconds (healthy)",
          Health: "healthy",
          ExitCode: 0
        }),
        JSON.stringify({
          Service: "worker",
          Name: "demo-worker-1",
          State: "running",
          Status: "Up 3 seconds"
        })
      ].join("\n")
    );

    expect(statuses).toEqual([
      {
        service: "api",
        name: "demo-api-1",
        state: "running",
        status: "Up 3 seconds (healthy)",
        health: "healthy",
        exitCode: 0
      },
      {
        service: "worker",
        name: "demo-worker-1",
        state: "running",
        status: "Up 3 seconds",
        health: null,
        exitCode: null
      }
    ]);
  });
});

describe("assessComposeHealth", () => {
  it("passes when running services are healthy or have no Docker healthcheck", () => {
    const statuses: ComposeContainerStatus[] = [
      {
        service: "api",
        name: "demo-api-1",
        state: "running",
        status: "Up 3 seconds (healthy)",
        health: "healthy",
        exitCode: 0
      },
      {
        service: "worker",
        name: "demo-worker-1",
        state: "running",
        status: "Up 3 seconds",
        health: null,
        exitCode: 0
      }
    ];

    expect(assessComposeHealth(statuses, "compose services")).toEqual({
      kind: "healthy",
      summary: "compose services are running"
    });
  });

  it("stays pending while services are still starting", () => {
    const statuses: ComposeContainerStatus[] = [
      {
        service: "api",
        name: "demo-api-1",
        state: "running",
        status: "Up 2 seconds (health: starting)",
        health: "starting",
        exitCode: 0
      }
    ];

    expect(assessComposeHealth(statuses, "compose service api")).toEqual({
      kind: "pending",
      summary: "compose service api are still converging: api (demo-api-1) health is starting"
    });
  });

  it("waits for missing dependency services in the expected compose graph scope", () => {
    const statuses: ComposeContainerStatus[] = [
      {
        service: "api",
        name: "demo-api-1",
        state: "running",
        status: "Up 2 seconds (healthy)",
        health: "healthy",
        exitCode: 0
      }
    ];

    expect(assessComposeHealth(statuses, "compose service api", ["api", "db"])).toEqual({
      kind: "pending",
      summary: "compose service api are still converging: waiting for services: db"
    });
  });

  it("waits for declared Docker health checks even when a container is already running", () => {
    const statuses: ComposeContainerStatus[] = [
      {
        service: "db",
        name: "demo-db-1",
        state: "running",
        status: "Up 2 seconds",
        health: null,
        exitCode: 0
      }
    ];

    expect(assessComposeHealth(statuses, "compose service db", ["db"], ["db"])).toEqual({
      kind: "pending",
      summary:
        "compose service db are still converging: db (demo-db-1) is still waiting for Docker health"
    });
  });

  it("fails when a service exits or reports unhealthy", () => {
    const statuses: ComposeContainerStatus[] = [
      {
        service: "api",
        name: "demo-api-1",
        state: "running",
        status: "Up 4 seconds (unhealthy)",
        health: "unhealthy",
        exitCode: 0
      },
      {
        service: "worker",
        name: "demo-worker-1",
        state: "exited",
        status: "Exited (1) 1 second ago",
        health: null,
        exitCode: 1
      }
    ];

    expect(assessComposeHealth(statuses, "compose services")).toEqual({
      kind: "failed",
      summary:
        "compose services failed health checks: api (demo-api-1) is unhealthy (Up 4 seconds (unhealthy)); worker (demo-worker-1) is exited, exit code 1"
    });
  });

  it("allows successful one-off containers when running services are healthy", () => {
    const statuses: ComposeContainerStatus[] = [
      {
        service: "migrate",
        name: "demo-migrate-1",
        state: "exited",
        status: "Exited (0) 1 second ago",
        health: null,
        exitCode: 0
      },
      {
        service: "api",
        name: "demo-api-1",
        state: "running",
        status: "Up 4 seconds (healthy)",
        health: "healthy",
        exitCode: 0
      }
    ];

    expect(assessComposeHealth(statuses, "compose services")).toEqual({
      kind: "healthy",
      summary: "compose services are running"
    });
  });

  it("treats a fully successful one-off compose project as healthy", () => {
    const statuses: ComposeContainerStatus[] = [
      {
        service: "migrate",
        name: "demo-migrate-1",
        state: "exited",
        status: "Exited (0) 1 second ago",
        health: null,
        exitCode: 0
      }
    ];

    expect(assessComposeHealth(statuses, "compose services")).toEqual({
      kind: "healthy",
      summary: "compose services completed successfully"
    });
  });
});
