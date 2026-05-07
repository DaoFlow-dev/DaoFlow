export type StartupReadinessStatus = "starting" | "ready" | "degraded";

export type StartupReadinessCheck = {
  name: "migrations" | "initial-owner" | "localhost-server" | "workers";
  status: "pending" | "ok" | "failed" | "skipped";
  detail: string;
  updatedAt: string;
};

export type StartupReadinessState = {
  status: StartupReadinessStatus;
  ready: boolean;
  checks: StartupReadinessCheck[];
};

const checkNames: StartupReadinessCheck["name"][] = [
  "migrations",
  "initial-owner",
  "localhost-server",
  "workers"
];

const checks = new Map<StartupReadinessCheck["name"], StartupReadinessCheck>();

resetStartupReadiness();

export function resetStartupReadiness() {
  checks.clear();
  for (const name of checkNames) {
    checks.set(name, {
      name,
      status: "pending",
      detail: "Waiting for startup.",
      updatedAt: new Date().toISOString()
    });
  }
}

export function markStartupCheck(
  name: StartupReadinessCheck["name"],
  status: StartupReadinessCheck["status"],
  detail: string
) {
  checks.set(name, {
    name,
    status,
    detail,
    updatedAt: new Date().toISOString()
  });
}

export function getStartupReadiness(): StartupReadinessState {
  const values = [...checks.values()];
  const failed = values.some((check) => check.status === "failed");
  const pending = values.some((check) => check.status === "pending");
  const ready = !failed && !pending;

  return {
    status: ready ? "ready" : failed ? "degraded" : "starting",
    ready,
    checks: values
  };
}
