import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readExistingInstall, updateInstalledVersion } from "./installer-lifecycle";
import { TEMPORAL_WORKER_CONNECTED_DETAIL, waitForInstallHealth } from "./install-health";
import { parseEnvFile } from "./templates";

describe("readExistingInstall", () => {
  test("does not treat the public HTTPS URL as the local dashboard port", () => {
    const installDir = mkdtempSync(join(tmpdir(), "daoflow-existing-install-"));

    try {
      writeFileSync(
        join(installDir, ".env"),
        [
          "DAOFLOW_VERSION=0.5.5",
          "BETTER_AUTH_URL=https://deploy.example.com",
          "DAOFLOW_INITIAL_ADMIN_EMAIL=owner@example.com",
          "DAOFLOW_INITIAL_ADMIN_PASSWORD=secret-123"
        ].join("\n")
      );

      const existingInstall = readExistingInstall(installDir);
      expect(existingInstall?.domain).toBe("deploy.example.com");
      expect(existingInstall?.scheme).toBe("https");
      expect(existingInstall?.port).toBeUndefined();
      expect(existingInstall?.workflowProfile).toBe("lean");
    } finally {
      rmSync(installDir, { recursive: true, force: true });
    }
  });

  test("infers the Temporal profile for legacy installs and persists it during upgrade", () => {
    const envContent = [
      "DAOFLOW_VERSION=0.5.5",
      "DAOFLOW_ENABLE_TEMPORAL=true",
      "TEMPORAL_POSTGRES_PASSWORD=legacy-temporal-password"
    ].join("\n");

    const upgraded = parseEnvFile(updateInstalledVersion(envContent, "0.9.1"));

    expect(upgraded).toMatchObject({
      DAOFLOW_VERSION: "0.9.1",
      DAOFLOW_WORKFLOW_PROFILE: "temporal",
      COMPOSE_PROFILES: "temporal",
      DAOFLOW_ENABLE_TEMPORAL: "true",
      TEMPORAL_POSTGRES_PASSWORD: "legacy-temporal-password"
    });
  });

  test("requires the Temporal worker readiness detail instead of a generic HTTP 200", async () => {
    let requests = 0;
    const ready = await waitForInstallHealth({
      runtime: {
        fetch: () => {
          requests += 1;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: "ready",
                checks: [
                  {
                    name: "workers",
                    detail:
                      requests === 1
                        ? "Legacy execution worker connected."
                        : TEMPORAL_WORKER_CONNECTED_DETAIL
                  }
                ]
              }),
              { status: 200 }
            )
          );
        },
        sleep: () => Promise.resolve()
      },
      port: 3000,
      attempts: 2,
      intervalMs: 0,
      requiredWorkerDetail: TEMPORAL_WORKER_CONNECTED_DETAIL
    });

    expect(ready).toBe(true);
    expect(requests).toBe(2);
  });
});
