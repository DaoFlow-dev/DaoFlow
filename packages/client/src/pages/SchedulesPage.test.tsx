// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SchedulerLeaseCard } from "./SchedulesPage";

afterEach(cleanup);

describe("SchedulerLeaseCard", () => {
  it("shows the active scheduler instance and lease timing", () => {
    render(
      <SchedulerLeaseCard
        status={{
          key: "service-schedule-monitor",
          holderInstanceId: "control-plane-a",
          generation: 7,
          acquiredAt: "2026-07-19T10:00:00.000Z",
          renewedAt: "2026-07-19T10:01:20.000Z",
          expiresAt: "2026-07-19T10:02:50.000Z",
          active: true,
          leaseAgeMs: 90_000,
          renewalAgeMs: 10_000,
          expiresInMs: 80_000
        }}
      />
    );

    expect(screen.getByTestId("scheduler-state")).toHaveTextContent("Active leader");
    expect(screen.getByTestId("scheduler-instance")).toHaveTextContent("control-plane-a");
    expect(screen.getByTestId("scheduler-generation")).toHaveTextContent("7");
    expect(screen.getByTestId("scheduler-lease-age")).toHaveTextContent("1m 30s");
    expect(screen.getByTestId("scheduler-renewal-age")).toHaveTextContent("10s ago");
    expect(screen.getByTestId("scheduler-expires-at")).toHaveTextContent("1m 20s");
  });

  it("shows an explicit empty state before the first lease is acquired", () => {
    render(<SchedulerLeaseCard status={null} />);

    expect(screen.getByTestId("scheduler-state")).toHaveTextContent("No lease recorded");
    expect(screen.getByTestId("scheduler-empty")).toHaveTextContent(
      "No control-plane instance has acquired"
    );
  });
});
