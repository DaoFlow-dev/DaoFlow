import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/connection";
import { servers } from "../db/schema/servers";
import { resolveServiceRuntime } from "../db/services/service-runtime";
import { getLatestServerMetrics, listServerMetricsHistory } from "../db/services/server-metrics";
import { resolveTeamIdForUser } from "../db/services/teams";
import { collectServerMetrics } from "../worker/server-metrics-collector";
import { detectPortConflicts } from "../worker/port-conflict-detection";
import { resolveExecutionTarget } from "../worker/execution-target";
import { readServiceStats } from "../worker/service-observability";
import { authorizeRequest } from "./request-auth";

export const serviceObservabilityRouter = new Hono();

serviceObservabilityRouter.get("/container-stats/:serviceId", async (c) => {
  const authResult = await authorizeRequest({
    headers: c.req.raw.headers,
    requiredScopes: ["diagnostics:read"]
  });
  if (!authResult.ok) {
    return c.json(authResult.body, authResult.status);
  }

  const teamId = await resolveTeamIdForUser(authResult.actor.session.user.id);
  if (!teamId) {
    return c.json(
      { ok: false, error: "No organization is available for this user.", code: "NO_TEAM" },
      412
    );
  }

  const runtimeResult = await resolveServiceRuntime(c.req.param("serviceId"), {
    teamId,
    actor: {
      id: authResult.actor.session.user.id,
      email: authResult.actor.session.user.email,
      role: authResult.actor.role,
      actorType: authResult.actor.auth.method === "api-token" ? "token" : "user"
    },
    action: "service.observability.denied",
    permissionScope: "diagnostics:read"
  });
  if (runtimeResult.status !== "ok") {
    const status = runtimeResult.status === "not_found" ? 404 : 409;
    return c.json(
      {
        ok: false,
        error: runtimeResult.message,
        code: runtimeResult.status.toUpperCase()
      },
      status
    );
  }

  const stats = await readServiceStats(runtimeResult.runtime);
  if (!stats) {
    return c.json(
      {
        ok: false,
        error: "No running container metrics are available for this service.",
        code: "NOT_RUNNING"
      },
      409
    );
  }

  return c.json(stats);
});

serviceObservabilityRouter.get("/server-metrics/:serverId", async (c) => {
  const authResult = await authorizeRequest({
    headers: c.req.raw.headers,
    requiredScopes: ["diagnostics:read"]
  });
  if (!authResult.ok) {
    return c.json(authResult.body, authResult.status);
  }

  const serverId = c.req.param("serverId");
  const live = c.req.query("live") === "true";

  if (live) {
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      return c.json({ ok: false, error: "Server not found", code: "NOT_FOUND" }, 404);
    }
    const teamId = await resolveTeamIdForUser(authResult.actor.session.user.id);
    const target = await resolveExecutionTarget(server, "metrics", teamId ?? undefined);
    const snapshot = await collectServerMetrics(target);
    if (!snapshot) {
      return c.json(
        { ok: false, error: "Failed to collect server metrics", code: "COLLECTION_FAILED" },
        502
      );
    }
    return c.json(snapshot);
  }

  const since = c.req.query("since");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 60, 1), 500) : 60;

  if (since || limit > 1) {
    const history = await listServerMetricsHistory(serverId, limit, since ?? undefined);
    return c.json(history);
  }

  const latest = await getLatestServerMetrics(serverId);
  if (!latest) {
    return c.json(
      { ok: false, error: "No metrics available for this server", code: "NO_DATA" },
      404
    );
  }
  return c.json(latest);
});

serviceObservabilityRouter.post("/port-check/:serverId", async (c) => {
  const authResult = await authorizeRequest({
    headers: c.req.raw.headers,
    requiredScopes: ["diagnostics:read"]
  });
  if (!authResult.ok) {
    return c.json(authResult.body, authResult.status);
  }

  const serverId = c.req.param("serverId");
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) {
    return c.json({ ok: false, error: "Server not found", code: "NOT_FOUND" }, 404);
  }

  const body = await c.req.json<{ ports?: Array<{ port: number; protocol?: string }> }>();
  const ports = (body.ports ?? [])
    .filter((p) => typeof p.port === "number" && p.port >= 1 && p.port <= 65535)
    .map((p) => ({
      port: p.port,
      protocol: p.protocol === "udp" ? ("udp" as const) : ("tcp" as const)
    }));

  if (ports.length === 0) {
    return c.json({ conflicts: [], checked: [] });
  }

  const teamId = await resolveTeamIdForUser(authResult.actor.session.user.id);
  const target = await resolveExecutionTarget(server, "port-check", teamId ?? undefined);
  const report = await detectPortConflicts(target, ports);
  return c.json(report);
});
