import { describe, expect, test } from "bun:test";
import {
  buildCloudflareTunnelGuide,
  getCloudflareTunnelConfigurationError,
  getCloudflareTunnelDashboardUrl,
  resolveCloudflareTunnelToken
} from "./install-cloudflare";

describe("install cloudflare helpers", () => {
  test("reuses explicit or preserved named tunnel tokens when enabled", () => {
    expect(
      resolveCloudflareTunnelToken({
        enabled: true,
        token: "explicit-token",
        existingEnv: {
          CLOUDFLARE_TUNNEL_TOKEN: "preserved-token"
        }
      })
    ).toBe("explicit-token");

    expect(
      resolveCloudflareTunnelToken({
        enabled: true,
        existingEnv: {
          CLOUDFLARE_TUNNEL_TOKEN: "preserved-token"
        }
      })
    ).toBe("preserved-token");
  });

  test("requires a tunnel token when Cloudflare Tunnel is enabled", () => {
    expect(
      getCloudflareTunnelConfigurationError({
        enabled: true,
        token: "my-token"
      })
    ).toBeNull();

    expect(
      getCloudflareTunnelConfigurationError({
        enabled: true
      })
    ).toContain("Cloudflare tunnel token");

    expect(
      getCloudflareTunnelConfigurationError({
        enabled: false
      })
    ).toBeNull();
  });

  test("builds the public URL and proxy guide for the dashboard container", () => {
    expect(getCloudflareTunnelDashboardUrl("deploy.example.com")).toBe(
      "https://deploy.example.com"
    );
    expect(buildCloudflareTunnelGuide({ domain: "deploy.example.com" })).toEqual([
      "In Cloudflare Zero Trust, open the named tunnel that matches the token and add a public hostname for deploy.example.com.",
      "Use service type HTTP.",
      "Use origin URL http://daoflow:3000.",
      "If you later change the public hostname, update BETTER_AUTH_URL in .env and run docker compose up -d."
    ]);
  });
});
