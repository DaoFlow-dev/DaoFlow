import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { runCli } from "./program";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalFetch = globalThis.fetch;

describe("drift command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-drift-cli-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
    else delete process.env.DAOFLOW_URL;
    if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
    else delete process.env.DAOFLOW_TOKEN;
    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("returns the containment fields in the stable JSON envelope", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("/trpc/composeDriftReport");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                inspection: {
                  availability: "not-implemented",
                  blockers: [
                    "#230 strict SSH host identity",
                    "#233 DaoFlow-owned resource selection"
                  ],
                  limits: { minimumIntervalSeconds: 60, maxConcurrentPerServer: 1 },
                  collection: { composePsFormat: "json", inspectFields: [] },
                  persistence: {
                    allowed: ["normalized-diff"],
                    forbidden: ["raw-docker-inspect-output"]
                  }
                },
                summary: {
                  totalServices: 1,
                  cachedSnapshotServices: 1,
                  unavailableServices: 0,
                  driftedServices: 0,
                  blockedServices: 0,
                  reviewRequired: 1
                },
                reports: [
                  {
                    composeServiceId: "compose_api",
                    environmentId: "env_prod",
                    environmentName: "production",
                    projectId: "proj_api",
                    projectName: "API",
                    serviceName: "api",
                    composeFilePath: "/srv/api/compose.yaml",
                    target: { serverId: "srv_1", serverName: "edge-1", composeProjectName: "api" },
                    source: "cached-snapshot",
                    authoritative: false,
                    attemptedAt: "2026-07-18T10:00:00.000Z",
                    observedAt: "2026-07-18T10:00:00.000Z",
                    maxAgeSeconds: 900,
                    evidenceRefs: [],
                    status: "unavailable",
                    statusLabel: "Cached snapshot cannot confirm alignment",
                    statusTone: "running",
                    summary:
                      "A cached snapshot exists, but it cannot verify current runtime alignment.",
                    impactSummary: null,
                    desiredImageReference: "ghcr.io/example/api:stable",
                    actualImageReference: "ghcr.io/example/api:stable",
                    desiredReplicaCount: 1,
                    actualReplicaCount: 1,
                    actualContainerState: "running",
                    recommendedActions: [],
                    diffs: []
                  }
                ]
              }
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "drift", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0] ?? "{}")).toMatchObject({
      ok: true,
      data: {
        inspection: { availability: "not-implemented" },
        reports: [
          {
            source: "cached-snapshot",
            authoritative: false,
            attemptedAt: "2026-07-18T10:00:00.000Z",
            observedAt: "2026-07-18T10:00:00.000Z",
            maxAgeSeconds: 900
          }
        ]
      }
    });
  });
});
