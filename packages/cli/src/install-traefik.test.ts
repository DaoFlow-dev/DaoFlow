import { describe, expect, test } from "bun:test";
import { getTraefikConfigurationError, resolveTraefikAcmeEmail } from "./install-traefik";

describe("install traefik helpers", () => {
  test("reuses explicit or preserved ACME email when Traefik is enabled", () => {
    expect(
      resolveTraefikAcmeEmail({
        exposureMode: "traefik",
        acmeEmail: "ops@example.com",
        adminEmail: "owner@example.com"
      })
    ).toBe("ops@example.com");

    expect(
      resolveTraefikAcmeEmail({
        exposureMode: "traefik",
        adminEmail: "owner@example.com",
        existingEnv: {
          DAOFLOW_ACME_EMAIL: "preserved@example.com"
        }
      })
    ).toBe("preserved@example.com");
  });

  test("validates public-domain and port requirements for Traefik installs", () => {
    expect(
      getTraefikConfigurationError({
        exposureMode: "traefik",
        domain: "localhost",
        port: 3000,
        acmeEmail: "ops@example.com"
      })
    ).toContain("public domain");

    expect(
      getTraefikConfigurationError({
        exposureMode: "traefik",
        domain: "deploy.example.com",
        port: 443,
        acmeEmail: "ops@example.com"
      })
    ).toContain("other than 80 or 443");

    expect(
      getTraefikConfigurationError({
        exposureMode: "traefik",
        domain: "deploy.example.com",
        port: 3000,
        acmeEmail: "invalid"
      })
    ).toContain("Let's Encrypt email");
  });
});
