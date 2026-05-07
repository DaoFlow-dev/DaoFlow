import { Hono } from "hono";
import { resolveServiceRuntime } from "../db/services/service-runtime";
import { resolveTeamIdForUser } from "../db/services/teams";
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
