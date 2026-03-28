// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeploymentsTab from "./DeploymentsTab";

const {
  recentDeploymentsUseQueryMock,
  rollbackTargetsUseQueryMock,
  cancelDeploymentUseMutationMock
} = vi.hoisted(() => ({
  recentDeploymentsUseQueryMock: vi.fn(),
  rollbackTargetsUseQueryMock: vi.fn(),
  cancelDeploymentUseMutationMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    recentDeployments: {
      useQuery: recentDeploymentsUseQueryMock
    },
    rollbackTargets: {
      useQuery: rollbackTargetsUseQueryMock
    },
    cancelDeployment: {
      useMutation: cancelDeploymentUseMutationMock
    }
  }
}));

vi.mock("@/components/DeploymentLogViewer", () => ({
  default: () => <div data-testid="deployment-log-viewer">logs</div>
}));

vi.mock("@/components/DeploymentRollbackDialog", () => ({
  default: () => null
}));

vi.mock("@/components/DeploymentStateArtifacts", () => ({
  DeploymentStateArtifacts: () => <div data-testid="deployment-state-artifacts">artifacts</div>
}));

describe("DeploymentsTab", () => {
  beforeEach(() => {
    recentDeploymentsUseQueryMock.mockReturnValue({
      isLoading: false,
      refetch: vi.fn(),
      data: [
        {
          id: "depwatch1",
          serviceName: "api",
          status: "failed",
          lifecycleStatus: "failed",
          statusLabel: "Stalled",
          statusTone: "failed",
          conclusion: "failed",
          createdAt: "2026-03-28T12:00:00.000Z",
          startedAt: "2026-03-28T12:00:00.000Z",
          finishedAt: "2026-03-28T12:15:00.000Z",
          canCancel: false,
          canRollback: false,
          commitSha: "abcdef1234567890",
          imageTag: "ghcr.io/example/api:broken",
          recoveryGuidance: {
            source: "watchdog",
            summary: "DaoFlow stopped waiting because deployment progress went silent.",
            suspectedRootCause: "Deployment progress heartbeat timed out.",
            safeActions: [
              "Inspect the deployment logs immediately before the stall.",
              "Retry the rollout after the runtime is responsive again."
            ],
            evidence: [
              {
                kind: "watchdog",
                id: "deployment-watchdog-timeout",
                title: "Progress heartbeat timed out",
                detail: "The last recorded deployment heartbeat timed out."
              }
            ]
          },
          error: { code: "DEPLOYMENT_WATCHDOG_TIMEOUT", message: "raw-json-should-hide" },
          steps: []
        }
      ]
    });
    rollbackTargetsUseQueryMock.mockReturnValue({
      data: []
    });
    cancelDeploymentUseMutationMock.mockReturnValue({
      mutate: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows recovery guidance instead of a raw watchdog error blob", () => {
    render(<DeploymentsTab serviceId="svc_api" serviceName="api" />);

    fireEvent.click(screen.getByText("depwatch"));

    expect(screen.getByTestId("deployment-recovery-guidance-depwatch1")).toHaveTextContent(
      "DaoFlow stopped waiting because deployment progress went silent."
    );
    expect(screen.getByTestId("deployment-recovery-root-cause-depwatch1")).toHaveTextContent(
      "Deployment progress heartbeat timed out."
    );
    expect(
      screen.getByTestId("deployment-recovery-evidence-depwatch1-deployment-watchdog-timeout")
    ).toHaveTextContent("watchdog:Progress heartbeat timed out");
    expect(screen.queryByText(/raw-json-should-hide/i)).not.toBeInTheDocument();
  });
});
