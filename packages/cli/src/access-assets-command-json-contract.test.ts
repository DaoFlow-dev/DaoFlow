import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { accessAssetsCommand } from "./commands/access-assets";
import { captureCommandExecution } from "./login-test-helpers";

describe("access assets CLI JSON contract", () => {
  test("SSH key create requires confirmation", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(accessAssetsCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "access-assets",
        "ssh-key",
        "create",
        "--name",
        "prod-deploy",
        "--private-key",
        "fixture-key",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Create managed SSH key prod-deploy. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("SSH key list returns redacted metadata", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(accessAssetsCommand());
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;

    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("/trpc/managedSshKeys");
      return new Response(
        JSON.stringify({
          result: {
            data: [
              {
                id: "key_123",
                teamId: "team_foundation",
                name: "prod-deploy",
                username: "deploy",
                fingerprint: "sha256:abc",
                keyType: "ed25519",
                hasPrivateKey: true,
                status: "active",
                lastUsedAt: null,
                rotatedAt: null,
                createdAt: "2026-05-06T00:00:00.000Z",
                updatedAt: "2026-05-06T00:00:00.000Z"
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await program.parseAsync(["node", "daoflow", "access-assets", "ssh-key", "list", "--json"]);
      });

      expect(result.exitCode).toBeNull();
      expect(JSON.parse(result.logs[0])).toMatchObject({
        ok: true,
        data: {
          keys: [{ id: "key_123", hasPrivateKey: true }]
        }
      });
      expect(result.logs[0]).not.toContain("fixture-key");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
      else delete process.env.DAOFLOW_URL;
      if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
      else delete process.env.DAOFLOW_TOKEN;
    }
  });
});
