import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import type { AppRole } from "@daoflow/shared";

const id = () => randomUUID().replace(/-/g, "").slice(0, 32);

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readString(record: JsonRecord, key: string, fallback = "") {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function readNumber(record: JsonRecord, key: string, fallback: number | null = null) {
  const value = record[key];
  return typeof value === "number" ? value : fallback;
}

function readBoolean(record: JsonRecord, key: string, fallback = false) {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(record: JsonRecord, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export interface RegisterServerInput {
  name: string;
  host: string;
  region: string;
  sshPort: number;
  kind: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export async function registerServer(input: RegisterServerInput) {
  const byName = await db.select().from(servers).where(eq(servers.name, input.name)).limit(1);
  if (byName[0]) return { status: "conflict" as const, conflictField: "name" };

  const byHost = await db.select().from(servers).where(eq(servers.host, input.host)).limit(1);
  if (byHost[0]) return { status: "conflict" as const, conflictField: "host" };

  const serverId = id();
  const [server] = await db
    .insert(servers)
    .values({
      id: serverId,
      name: input.name,
      host: input.host,
      region: input.region,
      sshPort: input.sshPort,
      kind: input.kind,
      status: "pending verification",
      registeredByUserId: input.requestedByUserId,
      metadata: {},
      updatedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `server/${serverId}`,
    action: "server.register",
    inputSummary: `Registered server ${input.name} at ${input.host}`,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: "server",
      resourceId: serverId,
      resourceLabel: input.name,
      detail: `Registered server ${input.name} at ${input.host}.`
    }
  });

  return { status: "ok" as const, server };
}

export async function listServerReadiness(limit = 12) {
  const rows = await db.select().from(servers).orderBy(desc(servers.createdAt)).limit(limit);

  const checks = rows.map((server) => {
    const metadata = asRecord(server.metadata);
    const readiness = asRecord(metadata.readinessCheck);
    const hasSeededCheck = Object.keys(readiness).length > 0;

    if (hasSeededCheck) {
      return {
        serverId: server.id,
        serverName: server.name,
        serverHost: server.host,
        targetKind: server.kind,
        serverStatus: server.status,
        readinessStatus: readString(readiness, "readinessStatus", server.status),
        sshPort: server.sshPort,
        sshReachable: readBoolean(readiness, "sshReachable", server.status === "ready"),
        dockerReachable: readBoolean(readiness, "dockerReachable", server.status === "ready"),
        composeReachable: readBoolean(readiness, "composeReachable", server.status === "ready"),
        latencyMs: readNumber(readiness, "latencyMs"),
        checkedAt: readString(
          readiness,
          "checkedAt",
          server.lastCheckedAt?.toISOString() ?? server.createdAt.toISOString()
        ),
        issues: readStringArray(readiness, "issues"),
        recommendedActions: readStringArray(readiness, "recommendedActions")
      };
    }

    return {
      serverId: server.id,
      serverName: server.name,
      serverHost: server.host,
      targetKind: server.kind,
      serverStatus: server.status,
      readinessStatus: server.status === "ready" ? "ready" : "attention",
      sshPort: server.sshPort,
      sshReachable: false,
      dockerReachable: false,
      composeReachable: false,
      latencyMs: null as number | null,
      checkedAt: server.lastCheckedAt?.toISOString() ?? server.createdAt.toISOString(),
      issues: ["SSH handshake has not succeeded yet for this host."],
      recommendedActions: [
        "Validate SSH reachability, Docker Engine, and Compose before scheduling workloads."
      ]
    };
  });

  const measuredLatencies = checks
    .map((check) => check.latencyMs)
    .filter((latency): latency is number => typeof latency === "number");

  return {
    summary: {
      totalServers: checks.length,
      readyServers: checks.filter((check) => check.readinessStatus === "ready").length,
      attentionServers: checks.filter((check) => check.readinessStatus === "attention").length,
      blockedServers: checks.filter((check) => check.serverStatus === "offline").length,
      averageLatencyMs:
        measuredLatencies.length > 0
          ? Math.round(
              measuredLatencies.reduce((sum, latency) => sum + latency, 0) /
                measuredLatencies.length
            )
          : null
    },
    checks
  };
}

export async function listInfrastructureInventory() {
  const [serverRows, projectRows, envRows] = await Promise.all([
    db.select().from(servers).orderBy(desc(servers.createdAt)),
    db.select().from(projects).orderBy(desc(projects.createdAt)),
    db.select().from(environments).orderBy(desc(environments.createdAt))
  ]);

  const environmentsByProject = new Map<string, typeof envRows>();
  const environmentCountByServer = new Map<string, number>();

  for (const environment of envRows) {
    const projectEnvironments = environmentsByProject.get(environment.projectId) ?? [];
    projectEnvironments.push(environment);
    environmentsByProject.set(environment.projectId, projectEnvironments);

    const config = asRecord(environment.config);
    const targetServerId = readString(config, "targetServerId");
    if (targetServerId) {
      environmentCountByServer.set(
        targetServerId,
        (environmentCountByServer.get(targetServerId) ?? 0) + 1
      );
    }
  }

  return {
    summary: {
      totalServers: serverRows.length,
      totalProjects: projectRows.length,
      totalEnvironments: envRows.length,
      healthyServers: serverRows.filter((server) => server.status === "ready").length
    },
    servers: serverRows.map((server) => ({
      id: server.id,
      name: server.name,
      serverName: server.name,
      host: server.host,
      kind: server.kind,
      region: server.region ?? "",
      sshPort: server.sshPort,
      engineVersion: server.dockerVersion ?? "unknown",
      status: server.status === "ready" ? "healthy" : server.status,
      lastHeartbeatAt: server.lastCheckedAt?.toISOString() ?? null,
      environmentCount: environmentCountByServer.get(server.id) ?? 0
    })),
    projects: projectRows.map((project) => {
      const config = asRecord(project.config);
      const projectEnvironments = environmentsByProject.get(project.id) ?? [];
      const derivedServiceCount = projectEnvironments.reduce((sum, environment) => {
        const envConfig = asRecord(environment.config);
        const count = readNumber(envConfig, "serviceCount", 0) ?? 0;
        return sum + count;
      }, 0);

      return {
        id: project.id,
        name: project.name,
        repositoryUrl: project.repoUrl ?? "",
        defaultBranch: readString(config, "defaultBranch", "main"),
        serviceCount:
          readNumber(config, "serviceCount", derivedServiceCount) ?? derivedServiceCount,
        environmentCount:
          readNumber(config, "environmentCount", projectEnvironments.length) ??
          projectEnvironments.length,
        latestDeploymentStatus: readString(config, "latestDeploymentStatus", "healthy")
      };
    }),
    environments: envRows.map((environment) => {
      const config = asRecord(environment.config);
      return {
        id: environment.id,
        projectId: environment.projectId,
        projectName: readString(config, "projectName"),
        name: environment.name,
        targetServerName: readString(config, "targetServerName"),
        networkName: readString(config, "networkName"),
        composeFilePath: readString(config, "composeFilePath"),
        serviceCount: readNumber(config, "serviceCount", 0) ?? 0,
        status: environment.status
      };
    })
  };
}
