import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeComposeDeploy } from "./compose-deploy-execution";

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

describe("executeComposeDeploy", () => {
  test("uses intake plus streamed upload for direct compose context deployments", async () => {
    const contextDir = mkdtempSync(join(tmpdir(), "daoflow-compose-exec-"));
    tempDirs.push(contextDir);

    const composePath = join(contextDir, "compose.yaml");
    const composeContent = [
      "name: upload-stack",
      "services:",
      "  web:",
      "    build:",
      "      context: .",
      "      dockerfile: Dockerfile"
    ].join("\n");
    writeFileSync(composePath, composeContent, "utf8");
    writeFileSync(join(contextDir, "Dockerfile"), "FROM alpine:3.20\n", "utf8");
    writeFileSync(join(contextDir, "app.txt"), "hello\n", "utf8");

    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "session-token";

    const originalFetch = globalThis.fetch;
    const originalConsoleLog = console.log;
    const requests: Array<{ url: string; init: RequestInit & { duplex?: string } }> = [];
    console.log = () => {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({
        url,
        init: (init ?? {}) as RequestInit & { duplex?: string }
      });

      if (url.endsWith("/api/v1/deploy/uploads/intake")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, uploadId: "dep_upload_123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      if (url.endsWith("/api/v1/deploy/uploads/dep_upload_123")) {
        const stream = init?.body as NodeJS.ReadableStream | undefined;
        if (stream && typeof stream.on === "function") {
          await new Promise<void>((resolve, reject) => {
            stream.on("error", reject);
            stream.on("end", resolve);
            stream.resume();
          });
        }

        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, deploymentId: "dep_upload_123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }) as typeof fetch;

    try {
      await executeComposeDeploy(composeContent, true, {
        composePath,
        contextPath: contextDir,
        serverId: "srv_123",
        json: true
      });
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalConsoleLog;
    }

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://daoflow.test/api/v1/deploy/uploads/intake");
    expect(requests[1]?.url).toBe("https://daoflow.test/api/v1/deploy/uploads/dep_upload_123");

    const intakeHeaders = requests[0]?.init.headers as Record<string, string>;
    const uploadHeaders = requests[1]?.init.headers as Record<string, string>;
    expect(typeof requests[0]?.init.body).toBe("string");
    const intakeBody = JSON.parse(requests[0]?.init.body as string) as {
      server: string;
      compose: string;
      project: string;
    };

    expect(requests[0]?.init.method).toBe("POST");
    expect(requests[1]?.init.method).toBe("POST");
    expect(intakeBody).toEqual({
      server: "srv_123",
      compose: composeContent,
      project: "upload-stack"
    });
    expect(intakeHeaders["Content-Type"]).toBe("application/json");
    expect(intakeHeaders.Cookie).toBe(
      "better-auth.session_token=session-token; __Secure-better-auth.session_token=session-token"
    );
    expect("X-DaoFlow-Compose" in intakeHeaders).toBe(false);
    expect(uploadHeaders["Content-Type"]).toBe("application/gzip");
    expect(uploadHeaders.Cookie).toBe(
      "better-auth.session_token=session-token; __Secure-better-auth.session_token=session-token"
    );
    expect("X-DaoFlow-Compose" in uploadHeaders).toBe(false);
    expect(requests[1]?.init.duplex).toBe("half");
  });
});
