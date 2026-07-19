import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { createProgram, runCli } from "./program";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalFetch = globalThis.fetch;

describe("services command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-services-cli-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (originalUrl) {
      process.env.DAOFLOW_URL = originalUrl;
    } else {
      delete process.env.DAOFLOW_URL;
    }

    if (originalToken) {
      process.env.DAOFLOW_TOKEN = originalToken;
    } else {
      delete process.env.DAOFLOW_TOKEN;
    }

    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("services create in JSON mode still requires --yes", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "create",
        "--project",
        "proj_123",
        "--environment",
        "env_123",
        "--name",
        "web",
        "--source-type",
        "image",
        "--image",
        "ghcr.io/acme/web:latest",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Create service web in environment env_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("services create dry-run emits the standard success envelope", async () => {
    const program = createProgram();

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "services",
        "create",
        "--project",
        "proj_123",
        "--environment",
        "env_123",
        "--name",
        "web",
        "--source-type",
        "dockerfile",
        "--dockerfile",
        "apps/web/Dockerfile",
        "--port",
        "3000",
        "--healthcheck-path",
        "/ready",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        projectId: "proj_123",
        environmentId: "env_123",
        name: "web",
        sourceType: "dockerfile",
        dockerfilePath: "apps/web/Dockerfile",
        port: "3000",
        healthcheckPath: "/ready"
      }
    });
  });

  test("services schedules create dry-run emits the standard success envelope", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "schedules",
        "create",
        "--service",
        "svc_123",
        "--name",
        "health",
        "--command",
        "bun run healthcheck",
        "--cron",
        "*/15 * * * *",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        action: "service.schedule.create",
        serviceId: "svc_123",
        name: "health",
        command: "bun run healthcheck",
        cronExpression: "*/15 * * * *",
        timezone: "UTC",
        notifyOnFailure: true
      }
    });
  });

  test("services schedules run in JSON mode still requires --yes", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "schedules",
        "run",
        "--schedule",
        "sch_123",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "run schedule sch_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("services create returns service ids and next-step hints in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/createService");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                id: "svc_123",
                name: "web",
                slug: "web",
                sourceType: "image",
                status: "inactive",
                projectId: "proj_123",
                environmentId: "env_123",
                imageReference: "ghcr.io/acme/web:latest",
                dockerfilePath: null,
                composeServiceName: null,
                port: "3000",
                healthcheckPath: "/ready",
                replicaCount: "1",
                targetServerId: "srv_123",
                createdAt: "2026-03-28T00:00:00.000Z",
                updatedAt: "2026-03-28T00:00:00.000Z",
                config: {},
                domainConfig: null,
                runtimeConfig: null,
                runtimeConfigPreview: null
              }
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "create",
        "--project",
        "proj_123",
        "--environment",
        "env_123",
        "--name",
        "web",
        "--source-type",
        "image",
        "--image",
        "ghcr.io/acme/web:latest",
        "--server",
        "srv_123",
        "--port",
        "3000",
        "--healthcheck-path",
        "/ready",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        service: {
          id: "svc_123",
          projectId: "proj_123",
          environmentId: "env_123",
          name: "web",
          sourceType: "image",
          status: "inactive"
        },
        nextSteps: {
          plan: {
            command: "daoflow plan --service svc_123",
            description: "Preview the rollout steps and preflight checks for this service."
          },
          deploy: {
            command: "daoflow deploy --service svc_123 --yes",
            description: "Queue the first deployment when the plan looks correct."
          }
        }
      }
    });
  });

  test("services create rejects mismatched source-specific flags before any API call", async () => {
    const program = createProgram();

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "services",
        "create",
        "--project",
        "proj_123",
        "--environment",
        "env_123",
        "--name",
        "web",
        "--source-type",
        "compose",
        "--image",
        "ghcr.io/acme/web:latest",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Compose services require --compose-service.",
      code: "INVALID_INPUT"
    });
  });

  test("services create preserves exact missing-scope details in JSON mode", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: "Missing required scope(s): service:update",
              code: -32003,
              data: {
                code: "FORBIDDEN",
                httpStatus: 403,
                path: "createService",
                cause: {
                  code: "SCOPE_DENIED",
                  requiredScopes: ["service:update"],
                  grantedScopes: ["service:read"]
                }
              }
            }
          }),
          {
            status: 403,
            headers: { "content-type": "application/json" }
          }
        )
      )) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "create",
        "--project",
        "proj_123",
        "--environment",
        "env_123",
        "--name",
        "web",
        "--source-type",
        "image",
        "--image",
        "ghcr.io/acme/web:latest",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(2);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Missing required scope(s): service:update",
      code: "SCOPE_DENIED",
      requiredScopes: ["service:update"],
      grantedScopes: ["service:read"]
    });
  });

  test("bare services still maps to list when callers use createProgram directly", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/services");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: []
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await createProgram().parseAsync(["node", "daoflow", "services", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        projectId: null,
        services: []
      }
    });
  });

  test("services logging set requires confirmation before making an API call", async () => {
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.reject(new Error("unexpected API call"));
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "logging",
        "set",
        "--service",
        "svc_api",
        "--json"
      ]);
    });

    expect(fetchCalled).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Configure managed log rotation for service svc_api. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("services logging set dry-run returns the exact server-rendered Compose override", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("/trpc/previewServiceLoggingConfig");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                logging: {
                  managed: true,
                  driver: "json-file",
                  maxSizeMb: 20,
                  maxFiles: 4,
                  allowSourceOverride: true
                },
                runtimeConfigPreview:
                  'services:\n  api:\n    logging:\n      driver: json-file\n      options:\n        max-size: 20m\n        max-file: "4"\n'
              }
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "logging",
        "set",
        "--service",
        "svc_api",
        "--max-size-mb",
        "20",
        "--max-files",
        "4",
        "--take-ownership",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        serviceId: "svc_api",
        logging: {
          managed: true,
          driver: "json-file",
          maxSizeMb: 20,
          maxFiles: 4,
          allowSourceOverride: true
        },
        runtimeConfigPreview:
          'services:\n  api:\n    logging:\n      driver: json-file\n      options:\n        max-size: 20m\n        max-file: "4"\n'
      }
    });
  });

  test("services logging rejects values outside the supported bounds before any API call", async () => {
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.reject(new Error("unexpected API call"));
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "logging",
        "set",
        "--service",
        "svc_api",
        "--max-size-mb",
        "0",
        "--dry-run",
        "--json"
      ]);
    });

    expect(fetchCalled).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      error: "Maximum log size must be a whole number between 1 and 1024."
    });
  });

  test("services logging rejects excessive combined retention before any API call", async () => {
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.reject(new Error("unexpected API call"));
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "logging",
        "set",
        "--service",
        "svc_api",
        "--max-size-mb",
        "1024",
        "--max-files",
        "5",
        "--dry-run",
        "--json"
      ]);
    });

    expect(fetchCalled).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Combined log retention cannot exceed 4096 MB per container.",
      code: "INVALID_INPUT"
    });
  });

  test("services logging show reports configured and active container settings", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("/trpc/serviceLoggingState");
      const data = {
        service: { id: "svc_api", name: "api" },
        desired: {
          managed: true,
          driver: "json-file",
          maxSizeMb: 10,
          maxFiles: 3,
          allowSourceOverride: false
        },
        status: "aligned",
        inspectedAt: "2026-07-18T12:00:00.000Z",
        containers: [
          {
            name: "demo-api-1",
            driver: "json-file",
            maxSize: "10m",
            maxFiles: "3",
            matchesDesired: true
          }
        ]
      };
      return Promise.resolve(
        new Response(JSON.stringify({ result: { data } }), {
          headers: { "content-type": "application/json" }
        })
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "services",
        "logging",
        "show",
        "--service",
        "svc_api",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      data: {
        service: { id: "svc_api", name: "api" },
        configured: { maxSizeMb: 10, maxFiles: 3 },
        inspection: {
          status: "aligned",
          containers: [{ name: "demo-api-1", matchesDesired: true }]
        }
      }
    });
  });
});
