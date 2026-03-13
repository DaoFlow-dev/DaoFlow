import { randomUUID } from "node:crypto";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../connection";
import { servers } from "../schema/servers";
import { projects, environments } from "../schema/projects";
import { auditEntries } from "../schema/audit";
import type { AppRole } from "../../../shared/authz";

const id = () => randomUUID().replace(/-/g, "").slice(0, 32);

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
  const [server] = await db.insert(servers).values({
    id: serverId,
    name: input.name,
    host: input.host,
    region: input.region,
    sshPort: input.sshPort,
    kind: input.kind,
    status: "pending verification"
  }).returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `server/${serverId}`,
    action: "server.registered",
    inputSummary: `Registered server ${input.name} at ${input.host}`,
    permissionScope: "server:write",
    outcome: "success"
  });

  return { status: "ok" as const, server };
}

export async function listServerReadiness(limit = 12) {
  const rows = await db.select().from(servers).orderBy(desc(servers.createdAt)).limit(limit);

  const summary = {
    totalServers: rows.length,
    readyServers: rows.filter(s => s.status === "ready").length,
    attentionServers: rows.filter(s => s.status === "pending verification").length,
    blockedServers: rows.filter(s => s.status === "offline").length,
    averageLatencyMs: null as number | null
  };

  const checks = rows.map(s => ({
    serverId: s.id,
    serverName: s.name,
    serverHost: s.host,
    targetKind: s.kind,
    serverStatus: s.status,
    readinessStatus: s.status === "ready" ? "ready" : "attention",
    sshPort: s.sshPort,
    sshReachable: s.status === "ready",
    dockerReachable: s.status === "ready",
    composeReachable: s.status === "ready",
    latencyMs: null as number | null,
    checkedAt: s.lastCheckedAt ?? new Date().toISOString(),
    issues: [] as string[],
    recommendedActions: s.status !== "ready" ? ["Run SSH connectivity check"] : ([] as string[])
  }));

  return { summary, checks };
}

export async function listInfrastructureInventory() {
  const serverRows = await db.select().from(servers).orderBy(desc(servers.createdAt));
  const projectRows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  const envRows = await db.select().from(environments).orderBy(desc(environments.createdAt));

  return {
    summary: {
      totalServers: serverRows.length,
      totalProjects: projectRows.length,
      totalEnvironments: envRows.length,
      healthyServers: serverRows.filter(s => s.status === "ready").length
    },
    servers: serverRows.map(s => ({
      id: s.id,
      name: s.name,
      serverName: s.name,
      host: s.host,
      kind: s.kind,
      region: s.region ?? "",
      sshPort: s.sshPort,
      engineVersion: s.dockerVersion ?? "unknown",
      status: s.status === "ready" ? "healthy" : "degraded",
      lastHeartbeatAt: s.lastCheckedAt ?? null,
      environmentCount: 0
    })),
    projects: projectRows.map(p => ({
      id: p.id,
      name: p.name,
      repositoryUrl: p.repoUrl ?? "",
      defaultBranch: "main",
      serviceCount: 0,
      environmentCount: 0,
      latestDeploymentStatus: "healthy"
    })),
    environments: envRows.map(e => ({
      id: e.id,
      projectId: e.projectId,
      projectName: "",
      name: e.name,
      targetServerName: "",
      networkName: "",
      composeFilePath: "",
      serviceCount: 0,
      status: e.status
    }))
  };
}
