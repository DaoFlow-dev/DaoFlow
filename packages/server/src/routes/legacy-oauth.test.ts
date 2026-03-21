import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { createLegacyOauthRouter } from "./legacy-oauth";

describe("legacy OAuth compatibility route", () => {
  it("returns a 410 response with migration guidance", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/oauth/token", { method: "POST" });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "LEGACY_OAUTH_ENDPOINT_REMOVED"
    });
  });

  it("logs a deprecated caller only once per unique caller fingerprint", async () => {
    const logWarning = vi.fn();
    const app = new Hono();
    app.route("/api/v1/oauth", createLegacyOauthRouter({ logWarning }));

    const headers = {
      "user-agent": "legacy-client/1.0",
      origin: "https://demo.daoflow.dev",
      referer: "https://demo.daoflow.dev/settings/git/callback"
    };

    await app.request("/api/v1/oauth/token", { method: "POST", headers });
    await app.request("/api/v1/oauth/token", { method: "POST", headers });

    expect(logWarning).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledWith(
      expect.stringContaining("Deprecated OAuth token endpoint called")
    );
  });
});
