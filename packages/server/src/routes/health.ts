import { Hono } from "hono";
import { getStartupReadiness } from "../startup-readiness";

type Env = {
  Variables: {
    requestId: string;
  };
};

export const healthRouter = new Hono<Env>();

healthRouter.get("/health", (c) =>
  c.json({
    status: "healthy",
    service: "daoflow-control-plane",
    requestId: c.get("requestId"),
    timestamp: new Date().toISOString()
  })
);

healthRouter.get("/ready", (c) => {
  const readiness = getStartupReadiness();

  return c.json(
    {
      status: readiness.ready ? "ready" : "not-ready",
      service: "daoflow-control-plane",
      requestId: c.get("requestId"),
      timestamp: new Date().toISOString(),
      checks: readiness.checks
    },
    readiness.ready ? 200 : 503
  );
});
