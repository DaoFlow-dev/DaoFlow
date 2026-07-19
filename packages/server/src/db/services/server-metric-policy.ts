import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { serverMetricPolicies } from "../schema/server-metrics";
import { servers } from "../schema/servers";
import type { ServerMetricKey } from "./server-metric-types";

export interface ServerMetricPolicy {
  sampleIntervalSeconds: number;
  retentionDays: number;
  cpuWarnPercent: number;
  cpuHardPercent: number;
  memoryWarnPercent: number;
  memoryHardPercent: number;
  diskWarnPercent: number;
  diskHardPercent: number;
  dockerDiskWarnPercent: number;
  dockerDiskHardPercent: number;
  cooldownMinutes: number;
}

export const DEFAULT_SERVER_METRIC_POLICY: ServerMetricPolicy = {
  sampleIntervalSeconds: 60,
  retentionDays: 7,
  cpuWarnPercent: 0,
  cpuHardPercent: 0,
  memoryWarnPercent: 0,
  memoryHardPercent: 0,
  diskWarnPercent: 0,
  diskHardPercent: 0,
  dockerDiskWarnPercent: 0,
  dockerDiskHardPercent: 0,
  cooldownMinutes: 30
};

const POLICY_METRICS: Array<{
  key: ServerMetricKey;
  warning: keyof ServerMetricPolicy;
  hard: keyof ServerMetricPolicy;
}> = [
  { key: "cpu", warning: "cpuWarnPercent", hard: "cpuHardPercent" },
  { key: "memory", warning: "memoryWarnPercent", hard: "memoryHardPercent" },
  { key: "disk", warning: "diskWarnPercent", hard: "diskHardPercent" },
  { key: "dockerDisk", warning: "dockerDiskWarnPercent", hard: "dockerDiskHardPercent" }
];

function integerInRange(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

/**
 * Normalizes policy input at the service boundary. Route code can perform its
 * server:write authorization and audit record before it calls the scoped write.
 */
export function normalizeServerMetricPolicy(
  input: Partial<ServerMetricPolicy> = {}
): ServerMetricPolicy {
  const policy: ServerMetricPolicy = {
    sampleIntervalSeconds: integerInRange(
      "sampleIntervalSeconds",
      input.sampleIntervalSeconds ?? DEFAULT_SERVER_METRIC_POLICY.sampleIntervalSeconds,
      1,
      86_400
    ),
    retentionDays: integerInRange(
      "retentionDays",
      input.retentionDays ?? DEFAULT_SERVER_METRIC_POLICY.retentionDays,
      1,
      3_650
    ),
    cpuWarnPercent: integerInRange(
      "cpuWarnPercent",
      input.cpuWarnPercent ?? DEFAULT_SERVER_METRIC_POLICY.cpuWarnPercent,
      0,
      100
    ),
    cpuHardPercent: integerInRange(
      "cpuHardPercent",
      input.cpuHardPercent ?? DEFAULT_SERVER_METRIC_POLICY.cpuHardPercent,
      0,
      100
    ),
    memoryWarnPercent: integerInRange(
      "memoryWarnPercent",
      input.memoryWarnPercent ?? DEFAULT_SERVER_METRIC_POLICY.memoryWarnPercent,
      0,
      100
    ),
    memoryHardPercent: integerInRange(
      "memoryHardPercent",
      input.memoryHardPercent ?? DEFAULT_SERVER_METRIC_POLICY.memoryHardPercent,
      0,
      100
    ),
    diskWarnPercent: integerInRange(
      "diskWarnPercent",
      input.diskWarnPercent ?? DEFAULT_SERVER_METRIC_POLICY.diskWarnPercent,
      0,
      100
    ),
    diskHardPercent: integerInRange(
      "diskHardPercent",
      input.diskHardPercent ?? DEFAULT_SERVER_METRIC_POLICY.diskHardPercent,
      0,
      100
    ),
    dockerDiskWarnPercent: integerInRange(
      "dockerDiskWarnPercent",
      input.dockerDiskWarnPercent ?? DEFAULT_SERVER_METRIC_POLICY.dockerDiskWarnPercent,
      0,
      100
    ),
    dockerDiskHardPercent: integerInRange(
      "dockerDiskHardPercent",
      input.dockerDiskHardPercent ?? DEFAULT_SERVER_METRIC_POLICY.dockerDiskHardPercent,
      0,
      100
    ),
    cooldownMinutes: integerInRange(
      "cooldownMinutes",
      input.cooldownMinutes ?? DEFAULT_SERVER_METRIC_POLICY.cooldownMinutes,
      0,
      1_440
    )
  };

  for (const metric of POLICY_METRICS) {
    const warning = policy[metric.warning];
    const hard = policy[metric.hard];
    if (warning > 0 && hard > 0 && warning > hard) {
      throw new Error(`${metric.key} warning threshold cannot exceed its hard threshold.`);
    }
  }

  return policy;
}

export function getServerMetricThresholds(policy: ServerMetricPolicy, metric: ServerMetricKey) {
  switch (metric) {
    case "cpu":
      return { warning: policy.cpuWarnPercent, hard: policy.cpuHardPercent };
    case "memory":
      return { warning: policy.memoryWarnPercent, hard: policy.memoryHardPercent };
    case "disk":
      return { warning: policy.diskWarnPercent, hard: policy.diskHardPercent };
    case "dockerDisk":
      return { warning: policy.dockerDiskWarnPercent, hard: policy.dockerDiskHardPercent };
  }
}

export function toServerMetricPolicy(
  row: typeof serverMetricPolicies.$inferSelect | null | undefined
): ServerMetricPolicy {
  if (!row) return { ...DEFAULT_SERVER_METRIC_POLICY };

  return normalizeServerMetricPolicy({
    sampleIntervalSeconds: row.sampleIntervalSeconds,
    retentionDays: row.retentionDays,
    cpuWarnPercent: row.cpuWarnPercent,
    cpuHardPercent: row.cpuHardPercent,
    memoryWarnPercent: row.memoryWarnPercent,
    memoryHardPercent: row.memoryHardPercent,
    diskWarnPercent: row.diskWarnPercent,
    diskHardPercent: row.diskHardPercent,
    dockerDiskWarnPercent: row.dockerDiskWarnPercent,
    dockerDiskHardPercent: row.dockerDiskHardPercent,
    cooldownMinutes: row.cooldownMinutes
  });
}

export async function getServerMetricPolicy(serverId: string): Promise<ServerMetricPolicy> {
  const [row] = await db
    .select()
    .from(serverMetricPolicies)
    .where(eq(serverMetricPolicies.serverId, serverId))
    .limit(1);
  return toServerMetricPolicy(row);
}

export async function getServerMetricPolicyForTeam(serverId: string, teamId: string) {
  const [row] = await db
    .select({ policy: serverMetricPolicies })
    .from(servers)
    .leftJoin(serverMetricPolicies, eq(serverMetricPolicies.serverId, servers.id))
    .where(and(eq(servers.id, serverId), eq(servers.teamId, teamId)))
    .limit(1);

  return row ? toServerMetricPolicy(row.policy) : null;
}

export async function upsertServerMetricPolicyForTeam(input: {
  serverId: string;
  teamId: string;
  policy: Partial<ServerMetricPolicy>;
}) {
  const normalized = normalizeServerMetricPolicy(input.policy);
  const [server] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.id, input.serverId), eq(servers.teamId, input.teamId)))
    .limit(1);
  if (!server) return { status: "not_found" as const };

  const now = new Date();
  await db
    .insert(serverMetricPolicies)
    .values({
      serverId: input.serverId,
      ...normalized,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: serverMetricPolicies.serverId,
      set: { ...normalized, updatedAt: now }
    });

  return { status: "ok" as const, policy: normalized };
}

/**
 * Public policy configuration entry point for routes and CLI handlers. Callers
 * must authorize server:write and record their audit event before invoking it.
 */
export async function configureServerMetricPolicy(
  input: {
    serverId: string;
    teamId: string;
    policy?: Partial<ServerMetricPolicy>;
  } & Partial<ServerMetricPolicy>
) {
  const { serverId, teamId, policy: nestedPolicy, ...flatPolicy } = input;
  return upsertServerMetricPolicyForTeam({
    serverId,
    teamId,
    policy: { ...flatPolicy, ...nestedPolicy }
  });
}
