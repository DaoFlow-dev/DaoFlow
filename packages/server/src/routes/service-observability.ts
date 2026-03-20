import { Hono } from "hono";
import { resolveServiceRuntime } from "../db/services/service-runtime";
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

  const runtimeResult = await resolveServiceRuntime(c.req.param("serviceId"));
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
