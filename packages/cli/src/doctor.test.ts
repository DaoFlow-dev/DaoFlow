import { describe, expect, test } from "bun:test";
import { collectDoctorChecks } from "./commands/doctor";
import type { DaoFlowContext } from "./config";
import type { RouterOutputs } from "./trpc-client";

const context: DaoFlowContext = {
  apiUrl: "https://api.example.com",
  token: "dfl_test_token"
};

function createServerReadinessCheck(
  overrides: Partial<RouterOutputs["serverReadiness"]["checks"][number]> = {}
): RouterOutputs["serverReadiness"]["checks"][number] {
  return {
    serverId: "srv_123",
    serverName: "edge-1",
    serverHost: "edge-1.example.com",
    targetKind: "docker-engine",
    serverStatus: "attention",
    readinessStatus: "attention",
    statusTone: "warning",
    sshPort: 22,
    sshReachable: true,
    dockerReachable: false,
    composeReachable: false,
    dockerVersion: null,
    composeVersion: null,
    latencyMs: 125,
    checkedAt: "2026-03-20T22:00:00.000Z",
    issues: ["Docker daemon unreachable"],
    recommendedActions: ["Verify the Docker service is running"],
    ...overrides
  };
}

function createServerReadiness(
  overrides: Partial<RouterOutputs["serverReadiness"]> = {}
): RouterOutputs["serverReadiness"] {
  return {
    summary: {
      totalServers: 1,
      readyServers: 0,
      attentionServers: 1,
      blockedServers: 0,
      pollIntervalMs: 60_000,
      averageLatencyMs: 125
    },
    checks: [createServerReadinessCheck()],
    ...overrides
  };
}

describe("collectDoctorChecks", () => {
  test("preserves API health when readiness diagnostics fail", async () => {
    const result = await collectDoctorChecks({
      ctx: context,
      currentContext: "default",
      createClientImpl: () =>
        ({
          health: {
            query: () =>
              Promise.resolve({
                status: "healthy",
                service: "daoflow",
                timestamp: "2026-03-20T22:00:00.000Z"
              } satisfies RouterOutputs["health"])
          },
          serverReadiness: {
            query: () => Promise.reject(new Error("readiness unavailable"))
          }
        }) as never
    });

    const apiConnectivityCheck = result.checks.find((check) => check.name === "API connectivity");
    const readinessDiagnosticsCheck = result.checks.find(
      (check) => check.name === "Server readiness diagnostics"
    );

    expect(apiConnectivityCheck).toEqual({
      name: "API connectivity",
      status: "ok",
      detail: "Status: healthy | Service: daoflow"
    });
    expect(readinessDiagnosticsCheck).toEqual({
      name: "Server readiness diagnostics",
      status: "fail",
      detail: "Could not load persisted readiness data: readiness unavailable"
    });
  });

  test("maps attention servers to warnings instead of failures", async () => {
    const result = await collectDoctorChecks({
      ctx: context,
      currentContext: "default",
      createClientImpl: () =>
        ({
          health: {
            query: () =>
              Promise.resolve({
                status: "healthy",
                service: "daoflow",
                timestamp: "2026-03-20T22:00:00.000Z"
              } satisfies RouterOutputs["health"])
          },
          serverReadiness: {
            query: () => Promise.resolve(createServerReadiness())
          }
        }) as never
    });

    const serverCheck = result.checks.find((check) => check.name === "Server edge-1");

    expect(serverCheck).toBeDefined();
    expect(serverCheck?.name).toBe("Server edge-1");
    expect(serverCheck?.status).toBe("warn");
    expect(result.summary.warnings).toBe(1);
    expect(result.summary.failures).toBe(0);
  });
});
