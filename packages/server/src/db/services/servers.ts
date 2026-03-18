import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { verifyServerReadiness } from "./server-readiness";
import { normalizeInventoryStatus, type AppRole } from "@daoflow/shared";
import {
  newId as id,
  asRecord,
  readString,
  readNumber,
  readBoolean,
  readStringArray
} from "./json-helpers";

export interface RegisterServerInput {
  name: string;
  host: string;
  region: string;
  sshPort: number;
  sshUser?: string;
  sshPrivateKey?: string;
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
      sshUser: input.sshUser?.trim() || null,
      sshPrivateKeyEncrypted: input.sshPrivateKey?.trim()
        ? encrypt(input.sshPrivateKey.trim())
        : null,
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

  const verifiedServer = await verifyServerReadiness(server);

  return { status: "ok" as const, server: verifiedServer ?? server };
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
  const [serverRows, projectRows, envRows, serviceRows] = await Promise.all([
    db.select().from(servers).orderBy(desc(servers.createdAt)),
    db.select().from(projects).orderBy(desc(projects.createdAt)),
    db.select().from(environments).orderBy(desc(environments.createdAt)),
    db.select().from(services).orderBy(desc(services.createdAt))
  ]);

  const environmentsByProject = new Map<string, typeof envRows>();
  const environmentCountByServer = new Map<string, number>();
  const serviceCountByProject = new Map<string, number>();
  const serviceCountByEnvironment = new Map<string, number>();

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

  for (const service of serviceRows) {
    serviceCountByProject.set(
      service.projectId,
      (serviceCountByProject.get(service.projectId) ?? 0) + 1
    );
    serviceCountByEnvironment.set(
      service.environmentId,
      (serviceCountByEnvironment.get(service.environmentId) ?? 0) + 1
    );
  }

  return {
    summary: {
      totalServers: serverRows.length,
      totalProjects: projectRows.length,
      totalEnvironments: envRows.length,
      totalServices: serviceRows.length,
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
      sshUser: server.sshUser ?? "",
      engineVersion: server.dockerVersion ?? "unknown",
      status: normalizeInventoryStatus(server.status),
      statusTone: normalizeInventoryStatus(server.status),
      lastHeartbeatAt: server.lastCheckedAt?.toISOString() ?? null,
      environmentCount: environmentCountByServer.get(server.id) ?? 0
    })),
    projects: projectRows.map((project) => {
      const config = asRecord(project.config);
      const projectEnvironments = environmentsByProject.get(project.id) ?? [];
      const derivedServiceCount = serviceCountByProject.get(project.id) ?? 0;

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
        latestDeploymentStatus: readString(config, "latestDeploymentStatus", "healthy"),
        statusTone: normalizeInventoryStatus(
          readString(config, "latestDeploymentStatus", "healthy")
        )
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
        serviceCount: serviceCountByEnvironment.get(environment.id) ?? 0,
        status: environment.status,
        statusTone: normalizeInventoryStatus(environment.status)
      };
    })
  };
}

// ─── Delete server ──────────────────────────────────────────

export interface DeleteServerInput {
  serverId: string;
  deletedByUserId: string;
  deletedByEmail: string;
  deletedByRole: AppRole;
}

export async function deleteServer(input: DeleteServerInput) {
  const [server] = await db.select().from(servers).where(eq(servers.id, input.serverId)).limit(1);
  if (!server) return { status: "not-found" as const };

  // Check for active environments targeting this server
  const envRows = await db.select().from(environments);
  const activeEnvs = envRows.filter((env) => {
    const config = asRecord(env.config);
    return readString(config, "targetServerId") === input.serverId;
  });

  if (activeEnvs.length > 0) {
    return {
      status: "has-dependencies" as const,
      count: activeEnvs.length,
      message: `Server '${server.name}' has ${activeEnvs.length} active environment(s). Remove or reassign them first.`
    };
  }

  await db.delete(servers).where(eq(servers.id, input.serverId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.deletedByUserId,
    actorEmail: input.deletedByEmail,
    actorRole: input.deletedByRole,
    targetResource: `server/${input.serverId}`,
    action: "server.delete",
    inputSummary: `Deleted server ${server.name} (${server.host}).`,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: "server",
      resourceId: input.serverId,
      resourceLabel: server.name,
      detail: `Deleted server ${server.name} at ${server.host}.`
    }
  });

  return { status: "deleted" as const, serverId: input.serverId, serverName: server.name };
}
