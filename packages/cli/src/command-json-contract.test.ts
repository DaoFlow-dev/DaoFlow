import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupCommand } from "./commands/backup";
import { deployCommand } from "./commands/deploy";
import { databasesCommand } from "./commands/databases";
import { envCommand } from "./commands/env";
import { logDrainsCommand } from "./commands/log-drains";
import { logsCommand } from "./commands/logs";
import { notificationsCommand } from "./commands/notifications";
import { registerConfigCommand } from "./commands/config";
import { planCommand } from "./commands/plan";
import { serverCommand } from "./commands/server";
import { tokenCommand } from "./commands/token";
import { tunnelsCommand } from "./commands/tunnels";
import { runCli } from "./program";

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

async function captureCommandExecution(
  run: () => Promise<void>
): Promise<{ logs: string[]; errors: string[]; exitCode: number | null }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit.bind(process);
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;

  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(" "));
  };
  process.exit = (code?: number) => {
    throw new ExitSignal(code ?? 0);
  };

  try {
    await run();
  } catch (error) {
    if (error instanceof ExitSignal) {
      exitCode = error.code;
    } else {
      throw error;
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return { logs, errors, exitCode };
}

async function withTempConfigDir<T>(
  configContent: string,
  run: (configDir: string) => Promise<T>
): Promise<T> {
  const originalCwd = process.cwd();
  const configDir = mkdtempSync(join(tmpdir(), "daoflow-cli-config-"));

  try {
    writeFileSync(join(configDir, "daoflow.config.json"), configContent, "utf8");
    process.chdir(configDir);
    return await run(configDir);
  } finally {
    process.chdir(originalCwd);
    rmSync(configDir, { recursive: true, force: true });
  }
}

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalUrl = process.env.DAOFLOW_URL;
  const originalToken = process.env.DAOFLOW_TOKEN;
  const homeDir = mkdtempSync(join(tmpdir(), "daoflow-cli-home-"));

  delete process.env.DAOFLOW_URL;
  delete process.env.DAOFLOW_TOKEN;
  process.env.HOME = homeDir;

  try {
    return await run(homeDir);
  } finally {
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

    rmSync(homeDir, { recursive: true, force: true });
  }
}

describe("CLI JSON contract", () => {
  test("config generate-vapid emits the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    registerConfigCommand(program);

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "config", "generate-vapid", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);

    const payload = JSON.parse(result.logs[0]) as {
      ok: boolean;
      data: { publicKey: string; privateKey: string; instructions: Record<string, string> };
    };

    expect(payload.ok).toBe(true);
    expect(payload.data.publicKey.length).toBeGreaterThan(0);
    expect(payload.data.privateKey.length).toBeGreaterThan(0);
    expect(payload.data.instructions).toEqual({
      server: "Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables",
      client: "Set VITE_VAPID_PUBLIC_KEY in client .env"
    });
  });

  test("env set in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(envCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "env",
        "set",
        "--env-id",
        "env_123",
        "--key",
        "API_URL",
        "--value",
        "https://example.com",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Set API_URL in environment env_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("databases create dry-run masks supplied secrets", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(databasesCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "databases",
        "create",
        "--kind",
        "mysql",
        "--project",
        "proj_123",
        "--environment",
        "production",
        "--server",
        "srv_123",
        "--password",
        "app-secret",
        "--root-password",
        "root-secret",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    const payload = JSON.parse(result.logs[0]) as {
      ok: boolean;
      data: { password: string; rootPassword: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.password).toBe("[secret]");
    expect(payload.data.rootPassword).toBe("[secret]");
    expect(result.logs[0]).not.toContain("app-secret");
    expect(result.logs[0]).not.toContain("root-secret");
  });

  test("databases stop dry-run emits lifecycle preview without mutating", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(databasesCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "databases",
        "stop",
        "--service",
        "svc_db",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: { dryRun: true, serviceId: "svc_db", action: "stop" }
    });
  });

  test("databases delete in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(databasesCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "databases",
        "delete",
        "--service",
        "svc_db",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Delete managed database svc_db. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("notifications list returns the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(notificationsCommand());

    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        expect(url).toContain("/trpc/listChannels");

        return new Response(
          JSON.stringify({
            result: {
              data: [
                {
                  id: "ntf_ops",
                  name: "Ops Alerts",
                  channelType: "email",
                  webhookUrl: null,
                  email: "ops@daoflow.local",
                  projectFilter: "DaoFlow",
                  environmentFilter: "production",
                  eventSelectors: ["deploy.*"],
                  enabled: true,
                  createdAt: "2026-03-20T12:00:00.000Z",
                  updatedAt: "2026-03-20T12:00:00.000Z"
                }
              ]
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync(["node", "daoflow", "notifications", "list", "--json"]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        channels: [
          {
            id: "ntf_ops",
            name: "Ops Alerts",
            channelType: "email",
            webhookUrl: null,
            email: "ops@daoflow.local",
            projectFilter: "DaoFlow",
            environmentFilter: "production",
            eventSelectors: ["deploy.*"],
            enabled: true,
            createdAt: "2026-03-20T12:00:00.000Z",
            updatedAt: "2026-03-20T12:00:00.000Z"
          }
        ]
      }
    });
  });

  test("notifications logs returns the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(notificationsCommand());

    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        expect(url).toContain("/trpc/listDeliveryLogs");

        return new Response(
          JSON.stringify({
            result: {
              data: [
                {
                  id: "nlog_1",
                  channelId: "ntf_ops",
                  channelName: "Ops Alerts",
                  channelType: "generic_webhook",
                  eventType: "deploy.failed",
                  payload: {},
                  httpStatus: "200",
                  status: "delivered",
                  error: null,
                  sentAt: "2026-03-20T12:05:00.000Z"
                }
              ]
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "notifications",
            "logs",
            "--limit",
            "5",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        limit: 5,
        logs: [
          {
            id: "nlog_1",
            channelId: "ntf_ops",
            channelName: "Ops Alerts",
            channelType: "generic_webhook",
            eventType: "deploy.failed",
            payload: {},
            httpStatus: "200",
            status: "delivered",
            error: null,
            sentAt: "2026-03-20T12:05:00.000Z"
          }
        ]
      }
    });
  });

  test("server add in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "server",
        "add",
        "--name",
        "edge-vps-1",
        "--host",
        "203.0.113.42",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Register server edge-vps-1 at 203.0.113.42. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("server add forwards registration input and returns readiness in the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverCommand());

    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        expect(url).toContain("/trpc/registerServer");
        expect(init?.method).toBe("POST");

        const rawBody = typeof init?.body === "string" ? init.body : "";
        expect(rawBody).toContain("edge-vps-1");
        expect(rawBody).toContain("203.0.113.42");
        expect(rawBody).toContain("docker-engine");

        return new Response(
          JSON.stringify({
            result: {
              data: {
                id: "srv_edge_vps_1",
                name: "edge-vps-1",
                host: "203.0.113.42",
                region: "us-west-2",
                sshPort: 22,
                sshUser: "root",
                kind: "docker-engine",
                status: "attention",
                dockerVersion: null,
                composeVersion: null,
                metadata: {
                  readinessCheck: {
                    readinessStatus: "attention",
                    sshReachable: false,
                    dockerReachable: false,
                    composeReachable: false,
                    latencyMs: null,
                    checkedAt: "2026-03-20T21:59:00.000Z",
                    issues: ["No SSH private key is stored for this server."],
                    recommendedActions: [
                      "Add a per-server SSH user and private key before deploying."
                    ]
                  }
                }
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "server",
            "add",
            "--name",
            "edge-vps-1",
            "--host",
            "203.0.113.42",
            "--region",
            "us-west-2",
            "--yes",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        server: {
          id: "srv_edge_vps_1",
          name: "edge-vps-1",
          host: "203.0.113.42",
          region: "us-west-2",
          sshPort: 22,
          sshUser: "root",
          kind: "docker-engine",
          status: "attention",
          dockerVersion: null,
          composeVersion: null
        },
        readiness: {
          readinessStatus: "attention",
          sshReachable: false,
          dockerReachable: false,
          composeReachable: false,
          latencyMs: null,
          checkedAt: "2026-03-20T21:59:00.000Z",
          issues: ["No SSH private key is stored for this server."],
          recommendedActions: ["Add a per-server SSH user and private key before deploying."]
        }
      }
    });
  });

  test("server ops cleanup requires confirmation before execution", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "server",
        "ops",
        "cleanup",
        "--server",
        "srv_123",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Run cleanup on server srv_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("server ops cleanup dry-run forwards preview input", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverCommand());
    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        expect(url).toContain("/trpc/previewServerCleanup");
        expect(init?.method).toBe("POST");
        const body = typeof init?.body === "string" ? init.body : "";
        expect(body).toContain("srv_123");
        return new Response(
          JSON.stringify({
            result: {
              data: {
                status: "ok",
                operation: {
                  id: "op_cleanup_preview",
                  summary: "Cleanup preview found 0 exited containers."
                },
                result: { exitedContainers: 0 }
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "server",
            "ops",
            "cleanup",
            "--server",
            "srv_123",
            "--dry-run",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        status: "ok",
        operation: {
          id: "op_cleanup_preview",
          summary: "Cleanup preview found 0 exited containers."
        },
        result: { exitedContainers: 0 }
      }
    });
  });

  test("tunnels create requires confirmation before execution", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(tunnelsCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "tunnels",
        "create",
        "--name",
        "edge",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Create managed tunnel edge. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("log-drains create requires confirmation before execution", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(logDrainsCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "log-drains",
        "create",
        "--name",
        "ops",
        "--type",
        "generic_http",
        "--endpoint-url",
        "https://logs.example.com/ingest",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Create log drain ops. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("tunnels delete requires confirmation before execution", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(tunnelsCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "tunnels",
        "delete",
        "--tunnel-id",
        "tun_123",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Delete managed tunnel tun_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("log-drains retry requires confirmation before execution", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(logDrainsCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "log-drains",
        "retry",
        "--delivery-id",
        "ldl_123",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Retry log drain delivery ldl_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("services --project emits runtime-aware inventory in the standard success envelope", async () => {
    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";

      const fetchMock = (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        expect(url).toContain("/trpc/projectServices");
        expect(url).toContain("projectId");
        expect(url).toContain("proj_123");

        return new Response(
          JSON.stringify({
            result: {
              data: [
                {
                  id: "svc_api",
                  name: "api",
                  slug: "api",
                  sourceType: "compose",
                  status: "active",
                  statusTone: "healthy",
                  statusLabel: "Last known healthy",
                  projectId: "proj_123",
                  projectName: "Foundation",
                  environmentId: "env_prod",
                  environmentName: "production",
                  imageReference: "ghcr.io/daoflow/api:latest",
                  dockerfilePath: null,
                  composeServiceName: "api",
                  port: "3000",
                  healthcheckPath: "/ready",
                  replicaCount: "2",
                  targetServerId: "srv_edge_1",
                  createdAt: "2026-03-20T00:00:00.000Z",
                  updatedAt: "2026-03-20T00:00:00.000Z",
                  config: {},
                  domainConfig: null,
                  runtimeConfig: null,
                  runtimeConfigPreview: null,
                  runtimeSummary: {
                    status: "last-known-healthy",
                    statusLabel: "Last known healthy",
                    statusTone: "healthy",
                    summary: "api readiness probe passed at http://127.0.0.1:3000/ready (HTTP 200)",
                    observedAt: "2026-03-20T00:05:00.000Z"
                  },
                  rolloutStrategy: {
                    key: "compose-recreate",
                    label: "Compose recreate",
                    summary:
                      "DaoFlow currently runs `docker compose up -d` and promotes the rollout only after Docker health and the configured readiness probe pass. This is health-gated, but it is not a true rolling or zero-downtime update.",
                    downtimeRisk: "possible",
                    supportsZeroDowntime: false,
                    healthGate: "readiness-probe"
                  },
                  latestDeployment: {
                    id: "dep_123",
                    status: "verified",
                    statusLabel: "Health verified",
                    statusTone: "healthy",
                    summary: "api readiness probe passed at http://127.0.0.1:3000/ready (HTTP 200)",
                    commitSha: "abcdef1",
                    imageTag: "ghcr.io/daoflow/api:latest",
                    targetServerId: "srv_edge_1",
                    targetServerName: "edge-1",
                    createdAt: "2026-03-20T00:02:00.000Z",
                    finishedAt: "2026-03-20T00:05:00.000Z"
                  }
                }
              ]
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      };

      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await runCli(["node", "daoflow", "services", "--project", "proj_123", "--json"]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        projectId: "proj_123",
        services: [
          {
            id: "svc_api",
            name: "api",
            slug: "api",
            sourceType: "compose",
            status: "active",
            statusTone: "healthy",
            statusLabel: "Last known healthy",
            projectId: "proj_123",
            projectName: "Foundation",
            environmentId: "env_prod",
            environmentName: "production",
            imageReference: "ghcr.io/daoflow/api:latest",
            dockerfilePath: null,
            composeServiceName: "api",
            port: "3000",
            healthcheckPath: "/ready",
            replicaCount: "2",
            targetServerId: "srv_edge_1",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
            config: {},
            domainConfig: null,
            runtimeConfig: null,
            runtimeConfigPreview: null,
            runtimeSummary: {
              status: "last-known-healthy",
              statusLabel: "Last known healthy",
              statusTone: "healthy",
              summary: "api readiness probe passed at http://127.0.0.1:3000/ready (HTTP 200)",
              observedAt: "2026-03-20T00:05:00.000Z"
            },
            rolloutStrategy: {
              key: "compose-recreate",
              label: "Compose recreate",
              summary:
                "DaoFlow currently runs `docker compose up -d` and promotes the rollout only after Docker health and the configured readiness probe pass. This is health-gated, but it is not a true rolling or zero-downtime update.",
              downtimeRisk: "possible",
              supportsZeroDowntime: false,
              healthGate: "readiness-probe"
            },
            latestDeployment: {
              id: "dep_123",
              status: "verified",
              statusLabel: "Health verified",
              statusTone: "healthy",
              summary: "api readiness probe passed at http://127.0.0.1:3000/ready (HTTP 200)",
              commitSha: "abcdef1",
              imageTag: "ghcr.io/daoflow/api:latest",
              targetServerId: "srv_edge_1",
              targetServerName: "edge-1",
              createdAt: "2026-03-20T00:02:00.000Z",
              finishedAt: "2026-03-20T00:05:00.000Z"
            }
          }
        ]
      }
    });
  });

  test("services previews lists shadow environments in the standard success envelope", async () => {
    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";

      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        expect(url).toContain("/trpc/composePreviews");
        expect(url).toContain("svc_api");

        return new Response(
          JSON.stringify({
            result: {
              data: {
                service: {
                  id: "svc_api",
                  name: "api",
                  environmentId: "env_prod",
                  projectId: "proj_123"
                },
                previews: [
                  {
                    id: "penv_1",
                    key: "pr-42",
                    target: "pull-request",
                    branch: "feature/login",
                    pullRequestNumber: 42,
                    envBranch: "preview/pr-42",
                    stackName: "foundation-pr-42",
                    primaryDomain: "preview-42.example.test",
                    status: "active",
                    cleanupStatus: "not_requested",
                    latestDeploymentId: "dep_123",
                    latestAction: "deploy",
                    latestStatus: "healthy",
                    latestStatusLabel: "Succeeded",
                    latestStatusTone: "healthy",
                    lastRequestedAt: "2026-03-20T00:02:00.000Z",
                    lastFinishedAt: "2026-03-20T00:05:00.000Z",
                    isActive: true
                  }
                ]
              }
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await runCli([
            "node",
            "daoflow",
            "services",
            "previews",
            "--service",
            "svc_api",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        service: {
          id: "svc_api",
          name: "api",
          environmentId: "env_prod",
          projectId: "proj_123"
        },
        previews: [
          expect.objectContaining({
            id: "penv_1",
            key: "pr-42",
            status: "active",
            cleanupStatus: "not_requested"
          })
        ]
      }
    });
  });

  test("backup restore in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "backup",
        "restore",
        "--backup-run-id",
        "bkr_123",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "To restore from backup bkr_123, add --yes",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("backup verify exposes queued status and a practical evidence details path", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const originalFetch = globalThis.fetch;
    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        expect(url).toContain("/trpc/triggerTestRestore");

        return new Response(
          JSON.stringify({
            result: {
              data: {
                id: "restore_verify_123",
                backupRunId: "bkr_123",
                mode: "verification",
                workflowId: "restore-workflow-123",
                status: "queued",
                targetPath: null,
                verificationResult: null,
                triggeredByUserId: "usr_ops",
                startedAt: "2026-03-21T06:00:00.000Z",
                createdAt: "2026-03-21T06:00:00.000Z",
                completedAt: null
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "backup",
            "verify",
            "--backup-run-id",
            "bkr_123",
            "--yes",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        id: "restore_verify_123",
        backupRunId: "bkr_123",
        mode: "verification",
        workflowId: "restore-workflow-123",
        status: "queued",
        targetPath: null,
        verificationResult: null,
        triggeredByUserId: "usr_ops",
        startedAt: "2026-03-21T06:00:00.000Z",
        createdAt: "2026-03-21T06:00:00.000Z",
        completedAt: null,
        detailsCommand: "daoflow backup download --backup-run-id bkr_123 --json"
      }
    });
  });

  test("backup restore dry-run in JSON mode uses the planning lane and exits 3", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        expect(url).toContain("/trpc/backupRestorePlan");
        expect(url).toContain("backupRunId");

        return new Response(
          JSON.stringify({
            result: {
              data: {
                isReady: true,
                backupRun: {
                  id: "bkr_123",
                  policyId: "bpol_123",
                  policyName: "postgres-volume",
                  projectName: "foundation",
                  environmentName: "production",
                  serviceName: "postgres",
                  artifactPath: "s3://backups/postgres-2026-03-20.tar.zst",
                  checksum: null,
                  verifiedAt: null,
                  restoreCount: 1
                },
                target: {
                  destinationServerName: "foundation-vps-1",
                  path: "/var/lib/postgresql/data",
                  backupType: "volume",
                  databaseEngine: null
                },
                preflightChecks: [
                  {
                    status: "ok",
                    detail: "Resolved backup artifact s3://backups/postgres-2026-03-20.tar.zst."
                  }
                ],
                steps: ["Resolve", "Replay", "Queue"],
                executeCommand: "daoflow backup restore --backup-run-id bkr_123 --yes",
                approvalRequest: {
                  procedure: "requestApproval",
                  requiredScope: "approvals:create",
                  input: {
                    actionType: "backup-restore",
                    backupRunId: "bkr_123",
                    reason: "Describe why replaying this backup is safe and necessary."
                  }
                }
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "backup",
            "restore",
            "--backup-run-id",
            "bkr_123",
            "--dry-run",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
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
      }
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        plan: {
          isReady: true,
          backupRun: {
            id: "bkr_123",
            policyId: "bpol_123",
            policyName: "postgres-volume",
            projectName: "foundation",
            environmentName: "production",
            serviceName: "postgres",
            artifactPath: "s3://backups/postgres-2026-03-20.tar.zst",
            checksum: null,
            verifiedAt: null,
            restoreCount: 1
          },
          target: {
            destinationServerName: "foundation-vps-1",
            path: "/var/lib/postgresql/data",
            backupType: "volume",
            databaseEngine: null
          },
          preflightChecks: [
            {
              status: "ok",
              detail: "Resolved backup artifact s3://backups/postgres-2026-03-20.tar.zst."
            }
          ],
          steps: ["Resolve", "Replay", "Queue"],
          executeCommand: "daoflow backup restore --backup-run-id bkr_123 --yes",
          approvalRequest: {
            procedure: "requestApproval",
            requiredScope: "approvals:create",
            input: {
              actionType: "backup-restore",
              backupRunId: "bkr_123",
              reason: "Describe why replaying this backup is safe and necessary."
            }
          }
        }
      }
    });
  });

  test("control-plane recovery dry-run uses the plan procedure and standard envelope", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const originalFetch = globalThis.fetch;
    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        expect(url).toContain("/trpc/controlPlaneRecoveryPlan");
        expect(url).toContain("destinationId");

        return new Response(
          JSON.stringify({
            result: {
              data: {
                isReady: true,
                destination: { id: "dest_123", name: "recovery-s3", provider: "s3" },
                keyFingerprint: "sha256:recovery-key",
                rawKey: "do-not-print",
                checks: [{ status: "passed", detail: "Recovery key is available." }],
                requiredExternalSecrets: ["BETTER_AUTH_SECRET"]
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "backup",
            "recovery",
            "run",
            "--destination",
            "dest_123",
            "--dry-run",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        plan: {
          isReady: true,
          destination: { id: "dest_123", name: "recovery-s3", provider: "s3" },
          keyFingerprint: "sha256:recovery-key",
          checks: [{ status: "passed", detail: "Recovery key is available." }],
          requiredExternalSecrets: ["BETTER_AUTH_SECRET"]
        }
      }
    });
  });

  test("control-plane recovery run requires --yes before mutation", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "backup",
        "recovery",
        "run",
        "--destination",
        "dest_123",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error:
        "Create a control-plane recovery bundle in destination dest_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("logs forwards targeted filter options and returns the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(logsCommand());

    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        expect(url).toContain("/trpc/deploymentLogs");
        expect(url).toContain("query");
        expect(url).toContain("stderr");
        expect(url).toContain("control-plane");

        return new Response(
          JSON.stringify({
            result: {
              data: {
                summary: {
                  totalLines: 1,
                  stderrLines: 1,
                  deploymentCount: 1
                },
                lines: [
                  {
                    id: "log_foundation_failed_3",
                    deploymentId: "dep_foundation_20260311_1",
                    serviceName: "control-plane",
                    environmentName: "production-us-west",
                    stream: "stderr",
                    lineNumber: 3,
                    level: "error",
                    message: "Readiness endpoint /healthz returned 503 for 2 consecutive checks.",
                    createdAt: "2026-03-20T12:59:35.000Z"
                  }
                ]
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "logs",
            "control-plane",
            "--query",
            "readiness",
            "--stream",
            "stderr",
            "--lines",
            "25",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);

    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        service: "control-plane",
        deploymentId: null,
        query: "readiness",
        stream: "stderr",
        limit: 25,
        summary: {
          totalLines: 1,
          stderrLines: 1,
          deploymentCount: 1
        },
        lines: [
          {
            id: "log_foundation_failed_3",
            deploymentId: "dep_foundation_20260311_1",
            serviceName: "control-plane",
            environmentName: "production-us-west",
            stream: "stderr",
            lineNumber: 3,
            level: "error",
            message: "Readiness endpoint /healthz returned 503 for 2 consecutive checks.",
            createdAt: "2026-03-20T12:59:35.000Z"
          }
        ]
      }
    });
  });

  test("backup run dry-run still emits JSON and exits 3 without --json", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "backup",
        "run",
        "--policy",
        "pol_123",
        "--dry-run"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        action: "backup.run",
        policyId: "pol_123",
        message: "Would trigger one-off backup for policy pol_123"
      }
    });
  });

  test("backup list without --json reports API errors on stderr", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "http://127.0.0.1:9";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync(["node", "daoflow", "backup", "list"]);
        });
      } finally {
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
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.logs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    const [errorLine] = result.errors;
    expect(() => {
      JSON.parse(errorLine ?? "");
    }).toThrow();
  });

  test("token create in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(tokenCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "token",
        "create",
        "--name",
        "ci-bot",
        "--preset",
        "agent:read-only",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Creating agent token ci-bot requires --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("token revoke in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(tokenCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "token", "revoke", "--id", "tok_123", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Destructive operation — revoking token tok_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("plan in JSON mode requires either --service or --compose", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "plan", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Either --service or --compose is required.",
      code: "INVALID_INPUT"
    });
  });

  test("compose plan in JSON mode requires --server", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "plan",
        "--compose",
        "./compose.yaml",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "--server is required for compose planning.",
      code: "INVALID_INPUT"
    });
  });

  test("plan in JSON mode rejects explicit service and compose targets together", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "plan",
        "--service",
        "svc_123",
        "--compose",
        "./compose.yaml",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Choose either --service or --compose, not both.",
      code: "INVALID_INPUT"
    });
  });

  test("compose plan in JSON mode rejects preview targeting", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "plan",
        "--compose",
        "./compose.yaml",
        "--server",
        "srv_123",
        "--preview-branch",
        "feature/login",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Preview targeting is only supported with --service planning.",
      code: "INVALID_INPUT"
    });
  });

  test("plan in JSON mode does not pollute stdout when a config file is present", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await withTempConfigDir(JSON.stringify({ project: "demo" }), async () =>
      captureCommandExecution(async () => {
        await program.parseAsync(["node", "daoflow", "plan", "--json"]);
      })
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Either --service or --compose is required.",
      code: "INVALID_INPUT"
    });
  });

  test("deploy in JSON mode does not pollute stdout when a config file is present", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(deployCommand());

    const result = await withTempConfigDir(JSON.stringify({ project: "demo" }), async () =>
      captureCommandExecution(async () => {
        await program.parseAsync(["node", "daoflow", "deploy", "--json"]);
      })
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Either --service or --compose is required.",
      code: "INVALID_INPUT"
    });
  });

  test("compose deploy in JSON mode requires confirmation when local env_file assets need upload", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(deployCommand());

    const result = await withTempConfigDir(
      JSON.stringify({ project: "demo" }),
      async (configDir) => {
        writeFileSync(
          join(configDir, "compose.yaml"),
          [
            "services:",
            "  api:",
            "    image: nginx:alpine",
            "    env_file:",
            "      - ./runtime.env"
          ].join("\n"),
          "utf8"
        );
        writeFileSync(join(configDir, "runtime.env"), "API_TOKEN=secret\n", "utf8");

        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "deploy",
            "--compose",
            "./compose.yaml",
            "--server",
            "srv_123",
            "--json"
          ]);
        });
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error:
        "1 local env_file asset will be frozen (0.0MB, 3 files). Context will be bundled, uploaded to DaoFlow, and deployed on server srv_123. Pass --yes to confirm, or --dry-run to preview.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("compose plan in JSON mode rejects context roots that omit compose-relative local inputs", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await withTempConfigDir(
      JSON.stringify({ project: "demo" }),
      async (configDir) => {
        const contextDir = join(configDir, "bundle");
        mkdirSync(join(configDir, "deploy"), { recursive: true });
        mkdirSync(contextDir, { recursive: true });
        writeFileSync(
          join(configDir, "deploy", "compose.yaml"),
          [
            "services:",
            "  api:",
            "    image: nginx:alpine",
            "    env_file:",
            "      - ./runtime.env"
          ].join("\n"),
          "utf8"
        );
        writeFileSync(join(configDir, "deploy", "runtime.env"), "API_TOKEN=secret\n", "utf8");

        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "plan",
            "--compose",
            "./deploy/compose.yaml",
            "--context",
            "./bundle",
            "--server",
            "srv_123",
            "--json"
          ]);
        });
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error:
        "env_file for service api (./runtime.env) resolves outside the configured --context root ./bundle. Widen --context so every local compose input is included in the upload bundle.",
      code: "INVALID_INPUT"
    });
  });

  test("compose deploy in JSON mode rejects context roots that omit compose-relative local inputs", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(deployCommand());

    const result = await withTempConfigDir(
      JSON.stringify({ project: "demo" }),
      async (configDir) => {
        const contextDir = join(configDir, "bundle");
        mkdirSync(join(configDir, "deploy"), { recursive: true });
        mkdirSync(contextDir, { recursive: true });
        writeFileSync(
          join(configDir, "deploy", "compose.yaml"),
          [
            "services:",
            "  api:",
            "    image: nginx:alpine",
            "    env_file:",
            "      - ./runtime.env"
          ].join("\n"),
          "utf8"
        );
        writeFileSync(join(configDir, "deploy", "runtime.env"), "API_TOKEN=secret\n", "utf8");

        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "deploy",
            "--compose",
            "./deploy/compose.yaml",
            "--context",
            "./bundle",
            "--server",
            "srv_123",
            "--yes",
            "--json"
          ]);
        });
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    const payload = JSON.parse(result.logs[0]) as { ok: boolean; error: string; code: string };
    expect(payload).toMatchObject({
      ok: false,
      code: "INVALID_INPUT"
    });
    expect(payload.error).toContain(
      "env_file for service api (./runtime.env) resolves outside the configured --context root"
    );
    expect(payload.error).toContain("Widen --context so every local compose input is included");
    expect(payload.error).toContain("bundle");
  });
});
