import { describe, expect, test } from "vitest";
import {
  buildApprovalNotification,
  buildBackupNotification,
  buildDeployNotification,
  buildServerMetricNotification,
  buildTestNotification
} from "./notification-builders";

describe("notification payload builders", () => {
  test("preserves the owning team on every notification payload", async () => {
    const teamId = "team_1";
    const payloads = await Promise.all([
      buildBackupNotification({
        eventType: "backup.started",
        teamId,
        policyName: "daily",
        status: "started"
      }),
      buildDeployNotification({
        eventType: "deploy.started",
        teamId,
        projectName: "foundation",
        environmentName: "production",
        serviceName: "api",
        status: "started",
        deploymentId: "dep_1"
      }),
      buildApprovalNotification({
        eventType: "approval.request",
        teamId,
        status: "requested",
        requestId: "apr_1",
        actionType: "compose-release",
        resourceLabel: "api@production"
      }),
      buildTestNotification(teamId)
    ]);

    expect(payloads.every((payload) => payload.teamId === teamId)).toBe(true);
  });
});

describe("server metric notification builder", () => {
  test("includes the measured value and threshold without command output", async () => {
    const payload = await buildServerMetricNotification({
      eventType: "server.metrics.warning",
      serverName: "edge-1",
      teamId: "team_1",
      metric: "disk",
      measuredValue: 83.2,
      threshold: 80,
      observedAt: "2026-07-19T04:00:00.000Z",
      nextState: "warning"
    });

    expect(payload).toMatchObject({
      eventType: "server.metrics.warning",
      teamId: "team_1",
      severity: "warning",
      timestamp: "2026-07-19T04:00:00.000Z"
    });
    expect(payload.fields).toContainEqual({ name: "Measured", value: "83.2%", inline: true });
    expect(payload.fields).toContainEqual({ name: "Threshold", value: "80.0%", inline: true });
  });

  test("describes a threshold recovery without calling it an availability recovery", async () => {
    const payload = await buildServerMetricNotification({
      eventType: "server.metrics.recovered",
      serverName: "edge-1",
      teamId: "team_1",
      metric: "disk",
      measuredValue: 70,
      threshold: 80,
      observedAt: "2026-07-19T04:30:00.000Z",
      nextState: "hard"
    });

    expect(payload.message).toContain("disk recovered below its threshold");
    expect(payload.message).toContain("other metrics remain in a hard state");
    expect(payload.message).not.toContain("became reachable again");
  });

  test("uses a recovery event without inventing a threshold", async () => {
    const payload = await buildServerMetricNotification({
      eventType: "server.metrics.recovered",
      serverName: "edge-1",
      teamId: "team_1",
      metric: null,
      measuredValue: null,
      threshold: null,
      observedAt: "2026-07-19T04:30:00.000Z",
      nextState: "warning"
    });

    expect(payload.severity).toBe("success");
    expect(payload.message).toContain("became reachable again");
    expect(payload.message).toContain("warning state");
    expect(payload.message).not.toContain("healthy");
    expect(payload.fields?.some((field) => field.name === "Threshold")).toBe(false);
  });
});
