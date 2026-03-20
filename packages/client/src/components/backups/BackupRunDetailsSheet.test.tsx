// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BackupRunDetailsSheet, type BackupRunDetailsView } from "./BackupRunDetailsSheet";

function makeRun(overrides: Partial<BackupRunDetailsView> = {}): BackupRunDetailsView {
  return {
    id: "run_1",
    policyId: "policy_1",
    policyName: "postgres-volume",
    projectName: "DaoFlow",
    environmentName: "production",
    serviceName: "postgres",
    targetType: "volume",
    destinationName: "prod-backups",
    destinationProvider: "s3",
    destinationServerName: "foundation-vps-1",
    mountPath: "/var/lib/postgresql/data",
    backupType: "volume",
    databaseEngine: null,
    scheduleLabel: "0 2 * * *",
    retentionCount: 14,
    status: "failed",
    triggerKind: "scheduled",
    requestedBy: "scheduler",
    artifactPath: null,
    bytesWritten: null,
    checksum: null,
    verifiedAt: null,
    startedAt: "2026-03-20T02:00:00.000Z",
    finishedAt: "2026-03-20T02:07:00.000Z",
    error: "pg_dump lost the SSH transport before the archive uploaded.",
    restoreCount: 0,
    logsState: "available",
    logEntries: [
      {
        timestamp: "2026-03-20T02:00:00.000Z",
        level: "info",
        phase: "prepare",
        message: "Resolved policy control-plane-db for foundation-vps-1."
      },
      {
        timestamp: "2026-03-20T02:07:00.000Z",
        level: "error",
        phase: "failed",
        message: "pg_dump lost the SSH transport before the archive uploaded."
      }
    ],
    ...overrides
  };
}

describe("BackupRunDetailsSheet", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders persisted failed-run logs and summary details", () => {
    render(
      <BackupRunDetailsSheet
        open
        onOpenChange={() => undefined}
        isLoading={false}
        errorMessage={null}
        run={makeRun()}
      />
    );

    expect(screen.getByTestId("backup-run-details-status")).toHaveTextContent("failed");
    expect(screen.getByTestId("backup-run-details-failure-summary")).toHaveTextContent(
      "pg_dump lost the SSH transport"
    );
    expect(
      screen.getByText("Resolved policy control-plane-db for foundation-vps-1.")
    ).toBeVisible();
    expect(
      screen.getAllByText("pg_dump lost the SSH transport before the archive uploaded.")
    ).toHaveLength(2);
  });

  it("distinguishes unavailable logs from empty logs", () => {
    const { rerender } = render(
      <BackupRunDetailsSheet
        open
        onOpenChange={() => undefined}
        isLoading={false}
        errorMessage={null}
        run={makeRun({ logsState: "unavailable", logEntries: [] })}
      />
    );

    expect(screen.getByTestId("backup-run-log-state")).toHaveTextContent(
      "does not have persisted logs"
    );

    rerender(
      <BackupRunDetailsSheet
        open
        onOpenChange={() => undefined}
        isLoading={false}
        errorMessage={null}
        run={makeRun({ logsState: "empty", logEntries: [] })}
      />
    );

    expect(screen.getByTestId("backup-run-log-state")).toHaveTextContent(
      "no entries were recorded"
    );
  });

  it("shows the live polling badge for running runs", () => {
    render(
      <BackupRunDetailsSheet
        open
        onOpenChange={() => undefined}
        isLoading={false}
        errorMessage={null}
        run={makeRun({
          status: "running",
          error: null,
          logsState: "streaming",
          logEntries: [
            {
              timestamp: "2026-03-20T02:03:00.000Z",
              level: "info",
              phase: "backup",
              message: "Starting volume copy from /var/lib/postgresql/data."
            }
          ]
        })}
      />
    );

    expect(screen.getByTestId("backup-run-details-live")).toHaveTextContent("Live polling");
    expect(screen.getByTestId("backup-run-log-state")).toHaveTextContent("still active");
  });
});
