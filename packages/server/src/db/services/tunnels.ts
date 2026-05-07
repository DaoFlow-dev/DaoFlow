import { and, desc, eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { auditEntries, events } from "../schema/audit";
import { tunnelRoutes, tunnels } from "../schema/tunnels";
import { newId } from "./json-helpers";

export interface ManagedTunnelActor {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface SyncTunnelRouteInput {
  hostname: string;
  service: string;
  path?: string | null;
  status?: "active" | "inactive" | "error";
}

function serializeTunnel(
  tunnel: typeof tunnels.$inferSelect,
  routes: (typeof tunnelRoutes.$inferSelect)[] = []
) {
  return {
    ...tunnel,
    hasCredentials: Boolean(tunnel.credentialsEncrypted),
    credentialsEncrypted: undefined,
    createdAt: tunnel.createdAt.toISOString(),
    updatedAt: tunnel.updatedAt.toISOString(),
    routes: routes.map((route) => ({
      ...route,
      createdAt: route.createdAt.toISOString(),
      updatedAt: route.updatedAt.toISOString()
    }))
  };
}

async function recordTunnelAudit(input: {
  actor: ManagedTunnelActor;
  tunnelId: string;
  tunnelName: string;
  action: string;
  summary: string;
  outcome?: "success" | "failure";
}) {
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.actor.requestedByUserId,
    actorEmail: input.actor.requestedByEmail,
    actorRole: input.actor.requestedByRole,
    targetResource: `tunnel/${input.tunnelId}`,
    action: input.action,
    inputSummary: input.summary,
    permissionScope: "server:write",
    outcome: input.outcome ?? "success",
    metadata: {
      resourceType: "tunnel",
      resourceId: input.tunnelId,
      resourceLabel: input.tunnelName,
      detail: input.summary
    }
  });
}

async function recordTunnelEvent(input: {
  tunnelId: string;
  tunnelName: string;
  kind: string;
  summary: string;
}) {
  await db.insert(events).values({
    kind: input.kind,
    resourceType: "tunnel",
    resourceId: input.tunnelId,
    summary: input.summary,
    severity: "info",
    metadata: { tunnelName: input.tunnelName }
  });
}

export async function listManagedTunnels(teamId: string) {
  const tunnelRows = await db
    .select()
    .from(tunnels)
    .where(eq(tunnels.teamId, teamId))
    .orderBy(desc(tunnels.createdAt));
  const routeRows = await db.select().from(tunnelRoutes);

  return tunnelRows.map((tunnel) =>
    serializeTunnel(
      tunnel,
      routeRows.filter((route) => route.tunnelId === tunnel.id)
    )
  );
}

export async function getManagedTunnel(teamId: string, tunnelId: string) {
  const [tunnel] = await db
    .select()
    .from(tunnels)
    .where(and(eq(tunnels.id, tunnelId), eq(tunnels.teamId, teamId)))
    .limit(1);
  if (!tunnel) return null;
  const routes = await db.select().from(tunnelRoutes).where(eq(tunnelRoutes.tunnelId, tunnel.id));
  return serializeTunnel(tunnel, routes);
}

export async function createManagedTunnel(input: {
  teamId: string;
  name: string;
  tunnelId?: string | null;
  domain?: string | null;
  credentials?: string | null;
  actor: ManagedTunnelActor;
}) {
  const id = newId();
  const [tunnel] = await db
    .insert(tunnels)
    .values({
      id,
      teamId: input.teamId,
      name: input.name,
      tunnelId: input.tunnelId ?? null,
      domain: input.domain ?? null,
      credentialsEncrypted: input.credentials ? encrypt(input.credentials) : null,
      status: "inactive",
      config: { provider: "cloudflare" },
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();
  const summary = `Registered managed tunnel ${input.name}.`;
  await recordTunnelAudit({
    actor: input.actor,
    tunnelId: tunnel.id,
    tunnelName: tunnel.name,
    action: "tunnel.create",
    summary
  });
  await recordTunnelEvent({
    tunnelId: tunnel.id,
    tunnelName: tunnel.name,
    kind: "tunnel.created",
    summary
  });
  return serializeTunnel(tunnel);
}

export async function updateManagedTunnel(input: {
  teamId: string;
  tunnelId: string;
  name?: string;
  providerTunnelId?: string | null;
  domain?: string | null;
  status?: "active" | "inactive" | "error";
  actor: ManagedTunnelActor;
}) {
  const existing = await getManagedTunnel(input.teamId, input.tunnelId);
  if (!existing) return null;
  const [tunnel] = await db
    .update(tunnels)
    .set({
      name: input.name ?? existing.name,
      tunnelId: input.providerTunnelId ?? existing.tunnelId,
      domain: input.domain ?? existing.domain,
      status: input.status ?? existing.status,
      updatedAt: new Date()
    })
    .where(eq(tunnels.id, input.tunnelId))
    .returning();
  const summary = `Updated managed tunnel ${tunnel.name}.`;
  await recordTunnelAudit({
    actor: input.actor,
    tunnelId: tunnel.id,
    tunnelName: tunnel.name,
    action: "tunnel.update",
    summary
  });
  return getManagedTunnel(input.teamId, tunnel.id);
}

export async function rotateManagedTunnelCredentials(input: {
  teamId: string;
  tunnelId: string;
  credentials: string;
  actor: ManagedTunnelActor;
}) {
  const existing = await getManagedTunnel(input.teamId, input.tunnelId);
  if (!existing) return null;
  const [tunnel] = await db
    .update(tunnels)
    .set({ credentialsEncrypted: encrypt(input.credentials), updatedAt: new Date() })
    .where(eq(tunnels.id, input.tunnelId))
    .returning();
  const summary = `Rotated credentials for managed tunnel ${tunnel.name}.`;
  await recordTunnelAudit({
    actor: input.actor,
    tunnelId: tunnel.id,
    tunnelName: tunnel.name,
    action: "tunnel.credentials.rotate",
    summary
  });
  await recordTunnelEvent({
    tunnelId: tunnel.id,
    tunnelName: tunnel.name,
    kind: "tunnel.credentials.rotated",
    summary
  });
  return getManagedTunnel(input.teamId, tunnel.id);
}

export async function syncManagedTunnelRoutes(input: {
  teamId: string;
  tunnelId: string;
  routes: SyncTunnelRouteInput[];
  actor: ManagedTunnelActor;
}) {
  const existing = await getManagedTunnel(input.teamId, input.tunnelId);
  if (!existing) return null;
  await db.delete(tunnelRoutes).where(eq(tunnelRoutes.tunnelId, input.tunnelId));
  if (input.routes.length > 0) {
    await db.insert(tunnelRoutes).values(
      input.routes.map((route) => ({
        id: newId(),
        tunnelId: input.tunnelId,
        hostname: route.hostname,
        service: route.service,
        path: route.path ?? null,
        status: route.status ?? "active",
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );
  }
  const summary = `Synced ${input.routes.length} observed tunnel routes for ${existing.name}.`;
  await recordTunnelAudit({
    actor: input.actor,
    tunnelId: input.tunnelId,
    tunnelName: existing.name,
    action: "tunnel.routes.sync",
    summary
  });
  await recordTunnelEvent({
    tunnelId: input.tunnelId,
    tunnelName: existing.name,
    kind: "tunnel.routes.synced",
    summary
  });
  return getManagedTunnel(input.teamId, input.tunnelId);
}

export async function deleteManagedTunnel(input: {
  teamId: string;
  tunnelId: string;
  actor: ManagedTunnelActor;
}) {
  const existing = await getManagedTunnel(input.teamId, input.tunnelId);
  if (!existing) return null;
  await db.delete(tunnels).where(eq(tunnels.id, input.tunnelId));
  const summary = `Deleted managed tunnel ${existing.name}.`;
  await recordTunnelAudit({
    actor: input.actor,
    tunnelId: input.tunnelId,
    tunnelName: existing.name,
    action: "tunnel.delete",
    summary
  });
  return { deleted: true as const, tunnelId: input.tunnelId };
}
