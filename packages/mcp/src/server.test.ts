import { afterEach, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "./server";
import { resolveConnection } from "./config";
import { fail, ok, requireConfirm, runCall } from "./tool-helpers";

const ENV_KEYS = ["DAOFLOW_URL", "DAOFLOW_TOKEN"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

test("createMcpServer registers the full tool surface without collisions", () => {
  const server = createMcpServer(() => {
    throw new Error("client should not be constructed during registration");
  });
  expect(server).toBeInstanceOf(McpServer);
});

test("ok wraps data as pretty JSON text content", () => {
  const result = ok({ hello: "world" });
  expect(result.isError).toBeUndefined();
  expect(result.content[0].type).toBe("text");
  expect(JSON.parse(result.content[0].text)).toEqual({ hello: "world" });
});

test("fail marks the result as an error and embeds extras", () => {
  const result = fail("boom", { code: "SCOPE_DENIED" });
  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    ok: false,
    error: "boom",
    code: "SCOPE_DENIED"
  });
});

test("requireConfirm refuses unconfirmed mutations and allows confirmed ones", () => {
  const refusal = requireConfirm(undefined, "daoflow_trigger_deploy");
  expect(refusal?.isError).toBe(true);
  expect(JSON.parse(refusal!.content[0].text)).toMatchObject({ requiresConfirm: true });
  expect(requireConfirm(true, "daoflow_trigger_deploy")).toBeNull();
});

test("runCall surfaces tRPC-like errors as structured failures", async () => {
  const trpcError = Object.assign(new Error("Missing scope"), {
    data: { code: "SCOPE_DENIED", httpStatus: 403 }
  });
  const result = await runCall(() => Promise.reject(trpcError));
  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    error: "Missing scope",
    code: "SCOPE_DENIED",
    httpStatus: 403
  });
});

test("runCall returns query data on success", async () => {
  const result = await runCall(() => Promise.resolve({ ready: 2 }));
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toEqual({ ready: 2 });
});

test("resolveConnection reads DAOFLOW_URL and DAOFLOW_TOKEN and strips trailing slash", () => {
  process.env.DAOFLOW_URL = "https://daoflow.example.com/";
  process.env.DAOFLOW_TOKEN = "dfl_test_token";
  expect(resolveConnection()).toEqual({
    apiUrl: "https://daoflow.example.com",
    token: "dfl_test_token"
  });
});

test("resolveConnection rejects a half-configured environment", () => {
  process.env.DAOFLOW_URL = "https://daoflow.example.com";
  delete process.env.DAOFLOW_TOKEN;
  expect(() => resolveConnection()).toThrow(/both be set/);
});
