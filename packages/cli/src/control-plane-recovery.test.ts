import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { captureCommandExecution } from "./login-test-helpers";
import { runCli } from "./program";

const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalFetch = globalThis.fetch;

describe("control-plane recovery CLI commands", () => {
  beforeEach(() => {
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
    else delete process.env.DAOFLOW_URL;
    if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
    else delete process.env.DAOFLOW_TOKEN;
    globalThis.fetch = originalFetch;
  });

  test("list uses the recovery bundle array and inspect/metadata use their dedicated procedures", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/trpc/controlPlaneRecoveryBundles")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: {
                data: [
                  {
                    id: "rb_1",
                    status: "verified",
                    destinationId: "dest_1",
                    keyFingerprint: "sha256:recovery",
                    rawKey: "should-not-appear"
                  }
                ]
              }
            })
          )
        );
      }
      if (url.includes("/trpc/controlPlaneRecoveryBundleMetadata")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: {
                data: {
                  bundleId: "rb_1",
                  keyFingerprint: "sha256:recovery",
                  manifest: { formatVersion: 1, requiredExternalSecrets: ["ENCRYPTION_KEY"] }
                }
              }
            })
          )
        );
      }
      expect(url).toContain("/trpc/controlPlaneRecoveryBundle");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                id: "rb_1",
                status: "verified",
                keyFingerprint: "sha256:recovery",
                verification: { success: true }
              }
            }
          })
        )
      );
    }) as unknown as typeof fetch;

    const list = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "backup", "recovery", "list", "--json"]);
    });
    const inspect = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "recovery",
        "inspect",
        "--bundle",
        "rb_1",
        "--json"
      ]);
    });
    const metadata = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "recovery",
        "download-metadata",
        "--bundle",
        "rb_1",
        "--json"
      ]);
    });

    expect(list.exitCode).toBeNull();
    expect(JSON.parse(list.logs[0])).toEqual({
      ok: true,
      data: [
        {
          id: "rb_1",
          status: "verified",
          destinationId: "dest_1",
          keyFingerprint: "sha256:recovery"
        }
      ]
    });
    expect(JSON.parse(inspect.logs[0])).toEqual({
      ok: true,
      data: {
        id: "rb_1",
        status: "verified",
        keyFingerprint: "sha256:recovery",
        verification: { success: true }
      }
    });
    expect(JSON.parse(metadata.logs[0])).toEqual({
      ok: true,
      data: {
        bundleId: "rb_1",
        keyFingerprint: "sha256:recovery",
        manifest: { formatVersion: 1, requiredExternalSecrets: ["ENCRYPTION_KEY"] }
      }
    });
  });
});
