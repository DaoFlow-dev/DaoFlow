import { Hono } from "hono";
import { getStartupReadiness } from "../startup-readiness";
import { getServiceScheduleMonitorRuntimeStatus } from "../worker/service-schedule-monitor";

type Env = {
  Variables: {
    requestId: string;
  };
};

export const healthRouter = new Hono<Env>();

healthRouter.get("/health", (c) => {
  const scheduler = getServiceScheduleMonitorRuntimeStatus();
  return c.json({
    status: "healthy",
    service: "daoflow-control-plane",
    requestId: c.get("requestId"),
    timestamp: new Date().toISOString(),
    scheduler: {
      running: scheduler.running,
      cycleInProgress: scheduler.cycleInProgress,
      leaseHeld: Boolean(scheduler.activeLease),
      lastCycleFinishedAt: scheduler.lastCycleFinishedAt
    }
  });
});

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
