// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Table, TableBody } from "@/components/ui/table";
import { DeploymentRow } from "./DeploymentsPage";
import { ProjectCard } from "./ProjectsPage";
import { ServerCheckCard } from "./ServersPage";

vi.mock("../lib/auth-client", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: "user_1" } } }))
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    recentDeployments: {
      useQuery: vi.fn()
    },
    cancelDeployment: {
      useMutation: vi.fn()
    },
    projects: {
      useQuery: vi.fn()
    },
    createProject: {
      useMutation: vi.fn()
    },
    serverReadiness: {
      useQuery: vi.fn()
    },
    viewer: {
      useQuery: vi.fn()
    },
    registerServer: {
      useMutation: vi.fn()
    },
    useUtils: vi.fn()
  }
}));

describe("memoized list items", () => {
  it("ProjectCard skips re-render when parent state changes but props stay stable", () => {
    const onOpenProject = vi.fn();
    let nameReads = 0;
    const project = {
      id: "proj_1",
      name: "Console",
      sourceType: "compose",
      status: "healthy",
      repoFullName: "DaoFlow-dev/console",
      repoUrl: "https://github.com/DaoFlow-dev/console"
    };
    Object.defineProperty(project, "name", {
      enumerable: true,
      get() {
        nameReads += 1;
        return "Console";
      }
    });

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <MemoryRouter>
          <button onClick={() => setTick((value) => value + 1)}>tick {tick}</button>
          <ProjectCard project={project} onOpenProject={onOpenProject} />
        </MemoryRouter>
      );
    }

    render(<Harness />);

    expect(nameReads).toBeGreaterThan(0);
    const initialReads = nameReads;
    fireEvent.click(screen.getByRole("button", { name: /tick 0/i }));
    expect(nameReads).toBe(initialReads);
  });

  it("ServerCheckCard skips re-render when parent state changes but props stay stable", () => {
    let serverNameReads = 0;
    const check = {
      serverId: "srv_1",
      serverName: "foundation-1",
      serverHost: "10.0.0.4",
      targetKind: "docker-engine",
      sshPort: 22,
      readinessStatus: "ready",
      sshReachable: true,
      dockerReachable: true,
      composeReachable: true,
      checkedAt: "2026-03-20T00:00:00.000Z",
      latencyMs: 38,
      issues: [],
      recommendedActions: [],
      cpuPercent: 31,
      memPercent: 42,
      diskPercent: 48
    };
    Object.defineProperty(check, "serverName", {
      enumerable: true,
      get() {
        serverNameReads += 1;
        return "foundation-1";
      }
    });

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((value) => value + 1)}>tick {tick}</button>
          <ServerCheckCard check={check} />
        </>
      );
    }

    render(<Harness />);

    expect(serverNameReads).toBeGreaterThan(0);
    const initialReads = serverNameReads;
    fireEvent.click(screen.getByRole("button", { name: /tick 0/i }));
    expect(serverNameReads).toBe(initialReads);
  });

  it("DeploymentRow skips re-render when parent state changes but props stay stable", () => {
    let serviceNameReads = 0;
    const deployment = {
      id: "dep_1",
      serviceId: "svc_1",
      projectId: "proj_1",
      environmentName: "production",
      targetServerName: "foundation-1",
      statusTone: "success",
      statusLabel: "Healthy",
      lifecycleStatus: "healthy",
      status: "healthy",
      sourceType: "compose",
      createdAt: "2026-03-20T00:00:00.000Z",
      canRollback: true,
      conclusion: "success",
      requestedByEmail: "ops@example.com",
      commitSha: "abc123",
      imageTag: "ghcr.io/example/api:latest",
      steps: []
    };
    Object.defineProperty(deployment, "serviceName", {
      enumerable: true,
      get() {
        serviceNameReads += 1;
        return "api";
      }
    });
    const onToggleExpand = vi.fn();
    const onOpenRollback = vi.fn();
    const onCancelDeployment = vi.fn();

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((value) => value + 1)}>tick {tick}</button>
          <Table>
            <TableBody>
              <DeploymentRow
                deployment={deployment}
                isExpanded={false}
                cancelPending={false}
                onToggleExpand={onToggleExpand}
                onOpenRollback={onOpenRollback}
                onCancelDeployment={onCancelDeployment}
              />
            </TableBody>
          </Table>
        </>
      );
    }

    render(<Harness />);

    expect(serviceNameReads).toBeGreaterThan(0);
    const initialReads = serviceNameReads;
    fireEvent.click(screen.getByRole("button", { name: /tick 0/i }));
    expect(serviceNameReads).toBe(initialReads);
  });
});
