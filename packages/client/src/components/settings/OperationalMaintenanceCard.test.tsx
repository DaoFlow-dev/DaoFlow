// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalMaintenanceCard, type MaintenanceReport } from "./OperationalMaintenanceCard";

const sampleReport: MaintenanceReport = {
  generatedAt: "2026-03-28T18:00:00.000Z",
  defaults: {
    cleanupIntervalMs: 900000,
    previewCleanupBatchLimit: 20,
    deploymentWatchdogTimeoutMs: 900000,
    cliAuthRequestTtlMs: 600000,
    retainedArtifactWindowMs: 2592000000,
    incompleteUploadWindowMs: 3600000
  },
  current: {
    stalledDeployments: {
      eligibleCount: 1
    },
    stalePreviews: {
      previewEnabledServices: 2,
      eligibleCount: 1,
      items: [
        {
          serviceName: "api",
          previewKey: "pr-42",
          staleAt: "2026-03-28T17:00:00.000Z",
          stackName: "console-pr-42"
        }
      ]
    },
    expiredCliAuthRequests: {
      eligibleCount: 2
    },
    retainedArtifacts: {
      eligibleCount: 3,
      retainedArtifacts: 2,
      incompleteUploads: 1
    }
  },
  latestRun: {
    action: "maintenance.cleanup.run",
    actorEmail: "owner@daoflow.local",
    actorId: "user_foundation_owner",
    outcome: "success",
    summary:
      "Cleanup processed 1 stalled deployment, 1 stale preview, 2 expired CLI sign-ins, 3 retained artifacts.",
    createdAt: "2026-03-28T18:05:00.000Z"
  }
};

describe("OperationalMaintenanceCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders current cleanup candidates and latest run details", () => {
    render(
      <OperationalMaintenanceCard
        report={sampleReport}
        isLoading={false}
        canManage={true}
        isRunning={false}
        feedback={null}
        onRefresh={() => undefined}
        onDryRun={() => undefined}
        onRunNow={() => undefined}
      />
    );

    expect(screen.getByTestId("maintenance-summary-stalled")).toHaveTextContent("1");
    expect(screen.getByTestId("maintenance-summary-previews")).toHaveTextContent("1");
    expect(screen.getByTestId("maintenance-preview-items")).toHaveTextContent("console-pr-42");
    expect(screen.getByText(/owner@daoflow.local/i)).toBeVisible();
  });

  it("fires refresh, dry-run, and run handlers", () => {
    const onRefresh = vi.fn();
    const onDryRun = vi.fn();
    const onRunNow = vi.fn();

    render(
      <OperationalMaintenanceCard
        report={sampleReport}
        isLoading={false}
        canManage={true}
        isRunning={false}
        feedback="Dry run found 7 items eligible for cleanup."
        onRefresh={onRefresh}
        onDryRun={onDryRun}
        onRunNow={onRunNow}
      />
    );

    fireEvent.click(screen.getByTestId("maintenance-refresh-button"));
    fireEvent.click(screen.getByTestId("maintenance-dry-run-button"));
    fireEvent.click(screen.getByTestId("maintenance-run-button"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onDryRun).toHaveBeenCalledTimes(1);
    expect(onRunNow).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("maintenance-feedback")).toHaveTextContent("Dry run found 7 items");
  });
});
