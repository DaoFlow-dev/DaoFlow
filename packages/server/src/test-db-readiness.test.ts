import { describe, expect, it } from "vitest";
import { testDatabaseSchemaTestHooks } from "./test-db";

const currentSchema = {
  notificationChannelsTeamId: "team_id",
  serverMetricsDockerDiskUsedPercent: "docker_disk_used_percent",
  serverMetricsDockerDiskTotalGb: "docker_disk_total_gb",
  serverMetricsServerCollectedIndex: "server_metrics_server_collected_idx",
  serverMetricAlerts: "server_metric_alerts",
  serverMetricDeliveryCooldowns: "server_metric_delivery_cooldowns",
  serverMetricOutbox: "server_metric_outbox",
  serverMetricPolicies: "server_metric_policies",
  serverMetricStates: "server_metric_states"
};

describe("test database schema readiness", () => {
  it("accepts the current monitoring schema", () => {
    expect(testDatabaseSchemaTestHooks.hasLatestTestSchema(currentSchema)).toBe(true);
  });

  it.each([
    "notificationChannelsTeamId",
    "serverMetricsDockerDiskUsedPercent",
    "serverMetricsDockerDiskTotalGb",
    "serverMetricsServerCollectedIndex",
    "serverMetricAlerts",
    "serverMetricDeliveryCooldowns",
    "serverMetricOutbox",
    "serverMetricPolicies",
    "serverMetricStates"
  ] as const)("rejects a schema missing %s", (marker) => {
    expect(
      testDatabaseSchemaTestHooks.hasLatestTestSchema({
        ...currentSchema,
        [marker]: null
      })
    ).toBe(false);
  });
});
