import { afterEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployCommand } from "./commands/deploy";

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  delete process.env.DAOFLOW_URL;
  delete process.env.DAOFLOW_TOKEN;
});

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

function queueFullPayload() {
  return {
    ok: false,
    error: "Deployment queue for server srv_123 is full.",
    code: "DEPLOYMENT_QUEUE_FULL",
    serverId: "srv_123",
    maxQueuedDeployments: 20,
    queuedDeploymentCount: 20
  };
}

function expectQueueFullJson(result: {
  logs: string[];
  errors: string[];
  exitCode: number | null;
}): void {
  expect(result.exitCode).toBe(1);
  expect(result.errors).toEqual([]);
  expect(result.logs).toHaveLength(1);
  expect(JSON.parse(result.logs[0] ?? "")).toEqual(queueFullPayload());
}

function createDeployProgram(): Command {
  return new Command().name("daoflow").addCommand(deployCommand());
}

function setApiContext(): void {
  process.env.DAOFLOW_URL = "https://daoflow.test";
  process.env.DAOFLOW_TOKEN = "dfl_test_token";
}

function createComposeFixture(
  composeContent: string,
  extraFiles?: Record<string, string>
): {
  composePath: string;
  contextPath: string;
} {
  const contextPath = mkdtempSync(join(tmpdir(), "daoflow-deploy-queue-full-"));
  tempDirs.push(contextPath);
  const composePath = join(contextPath, "compose.yaml");
  writeFileSync(composePath, composeContent, "utf8");

  for (const [fileName, contents] of Object.entries(extraFiles ?? {})) {
    writeFileSync(join(contextPath, fileName), contents, "utf8");
  }

  return { composePath, contextPath };
}

describe("deploy queue-full JSON contract", () => {
  test("preserves queue-full details from service deployments", async () => {
    setApiContext();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("/trpc/triggerDeploy");
      return new Response(
        JSON.stringify({
          error: {
            message: "Deployment queue for server srv_123 is full.",
            code: -32009,
            data: {
              code: "CONFLICT",
              httpStatus: 409,
              path: "triggerDeploy",
              cause: {
                code: "DEPLOYMENT_QUEUE_FULL",
                serverId: "srv_123",
                maxQueuedDeployments: 20,
                queuedDeploymentCount: 20
              }
            }
          }
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await createDeployProgram().parseAsync([
          "node",
          "daoflow",
          "deploy",
          "--service",
          "svc_123",
          "--yes",
          "--json"
        ]);
      });
      expectQueueFullJson(result);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves queue-full details from direct Compose deployments", async () => {
    setApiContext();
    const { composePath, contextPath } = createComposeFixture(
      "services:\n  web:\n    image: nginx"
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://daoflow.test/api/v1/deploy/compose");
      return new Response(JSON.stringify(queueFullPayload()), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await createDeployProgram().parseAsync([
          "node",
          "daoflow",
          "deploy",
          "--compose",
          composePath,
          "--context",
          contextPath,
          "--server",
          "srv_123",
          "--yes",
          "--json"
        ]);
      });
      expectQueueFullJson(result);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves queue-full details from streamed context uploads", async () => {
    setApiContext();
    const { composePath, contextPath } = createComposeFixture(
      "services:\n  web:\n    build:\n      context: .\n      dockerfile: Dockerfile",
      { Dockerfile: "FROM alpine:3.20\n" }
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/v1/deploy/uploads/intake")) {
        return new Response(JSON.stringify({ ok: true, uploadId: "upl_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      expect(url).toBe("https://daoflow.test/api/v1/deploy/uploads/upl_123");
      const stream = init?.body as NodeJS.ReadableStream | undefined;
      if (stream && typeof stream.on === "function") {
        await new Promise<void>((resolve, reject) => {
          stream.on("error", reject);
          stream.on("end", resolve);
          stream.resume();
        });
      }

      return new Response(JSON.stringify(queueFullPayload()), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await createDeployProgram().parseAsync([
          "node",
          "daoflow",
          "deploy",
          "--compose",
          composePath,
          "--context",
          contextPath,
          "--server",
          "srv_123",
          "--yes",
          "--json"
        ]);
      });
      expectQueueFullJson(result);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
