import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loginCommand, loginRuntime } from "./commands/login";
import { getConfigFilePath } from "./config";
import { captureCommandExecution } from "./login-test-helpers";

const originalHome = process.env.HOME;
const originalFetch = globalThis.fetch;
const originalLoginRuntime = {
  fetch: loginRuntime.fetch,
  prompt: loginRuntime.prompt,
  sleep: loginRuntime.sleep,
  tryOpenBrowser: loginRuntime.tryOpenBrowser
};

describe("login command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-cli-login-"));
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    loginRuntime.fetch = originalLoginRuntime.fetch;
    loginRuntime.prompt = originalLoginRuntime.prompt;
    loginRuntime.sleep = originalLoginRuntime.sleep;
    loginRuntime.tryOpenBrowser = originalLoginRuntime.tryOpenBrowser;

    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    rmSync(homeDir, { recursive: true, force: true });
  });

  test("validates DaoFlow API tokens via Bearer auth and persists auth metadata", async () => {
    const fetchMock = mock(
      (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.endsWith("/health")) {
          return Promise.resolve(
            new Response(JSON.stringify({ status: "healthy" }), { status: 200 })
          );
        }

        if (url.endsWith("/trpc/viewer")) {
          expect((init?.headers as Record<string, string>)?.Authorization).toBe(
            "Bearer dfl_test_token"
          );
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: {
                  data: {
                    principal: { email: "agent@daoflow.local" },
                    authz: { authMethod: "api-token", role: "agent" }
                  }
                }
              }),
              { status: 200 }
            )
          );
        }

        throw new Error(`Unexpected fetch ${url}`);
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const program = new Command().name("daoflow");
    program.addCommand(loginCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "login",
        "--url",
        "https://deploy.example.com",
        "--token",
        "dfl_test_token",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        apiUrl: "https://deploy.example.com",
        context: "default",
        authMode: "token",
        validated: true,
        authMethod: "api-token",
        principalEmail: "agent@daoflow.local",
        role: "agent"
      }
    });

    const saved = JSON.parse(readFileSync(getConfigFilePath(), "utf8")) as {
      contexts: Record<string, { authMethod: string }>;
    };
    expect(saved.contexts.default?.authMethod).toBe("api-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("validates session-style tokens with Better Auth cookie headers", async () => {
    const fetchMock = mock(
      (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.endsWith("/health")) {
          return Promise.resolve(
            new Response(JSON.stringify({ status: "healthy" }), { status: 200 })
          );
        }

        if (url.endsWith("/trpc/viewer")) {
          expect((init?.headers as Record<string, string>)?.Cookie).toBe(
            "better-auth.session_token=session_test_token"
          );
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: {
                  data: {
                    principal: { email: "owner@daoflow.local" },
                    authz: { authMethod: "session", role: "owner" }
                  }
                }
              }),
              { status: 200 }
            )
          );
        }

        throw new Error(`Unexpected fetch ${url}`);
      }
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const program = new Command().name("daoflow");
    program.addCommand(loginCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "login",
        "--url",
        "https://deploy.example.com",
        "--token",
        "session_test_token",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        apiUrl: "https://deploy.example.com",
        context: "default",
        authMode: "token",
        validated: true,
        authMethod: "session",
        principalEmail: "owner@daoflow.local",
        role: "owner"
      }
    });
  });

  test("falls back to manual SSO device flow when no browser can be opened", async () => {
    const fetchMock = mock(
      (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.endsWith("/health")) {
          return Promise.resolve(
            new Response(JSON.stringify({ status: "healthy" }), { status: 200 })
          );
        }

        if (url.endsWith("/api/v1/cli-auth/start")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                requestId: "req_123",
                userCode: "ABCD-EFGH",
                verificationUri:
                  "https://deploy.example.com/cli/auth/device?requestId=req_123&userCode=ABCD-EFGH",
                intervalSeconds: 1,
                expiresAt: "2099-01-01T00:00:00.000Z"
              }),
              { status: 200 }
            )
          );
        }

        if (url.endsWith("/api/v1/cli-auth/exchange")) {
          expect(init?.body).toBe(
            JSON.stringify({
              requestId: "req_123",
              userCode: "ABCD-EFGH",
              exchangeCode: "cli_code_789"
            })
          );
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true, token: "session_from_sso" }), { status: 200 })
          );
        }

        if (url.endsWith("/trpc/viewer")) {
          expect((init?.headers as Record<string, string>)?.Cookie).toBe(
            "better-auth.session_token=session_from_sso"
          );
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: {
                  data: {
                    principal: { email: "owner@daoflow.local" },
                    authz: { authMethod: "session", role: "owner" }
                  }
                }
              }),
              { status: 200 }
            )
          );
        }

        throw new Error(`Unexpected fetch ${url}`);
      }
    );

    loginRuntime.fetch = fetchMock as unknown as typeof loginRuntime.fetch;
    loginRuntime.tryOpenBrowser = () => false;
    loginRuntime.prompt = (question: string) => {
      expect(question).toBe("Paste the one-time CLI code: ");
      return Promise.resolve("cli_code_789");
    };

    const program = new Command().name("daoflow");
    program.addCommand(loginCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "login",
        "--url",
        "https://deploy.example.com",
        "--sso"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toContain(
      'Logged in to https://deploy.example.com as context "default"'
    );
    expect(
      result.errors.some((line) =>
        line.includes("No browser could be opened automatically for SSO.")
      )
    ).toBe(true);
    expect(
      result.errors.some((line) =>
        line.includes(
          "Open this URL manually: https://deploy.example.com/cli/auth/device?requestId=req_123&userCode=ABCD-EFGH"
        )
      )
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
