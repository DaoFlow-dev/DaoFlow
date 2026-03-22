import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import {
  buildInstallComposeContent,
  getTraefikConfigurationError,
  resolveTraefikAcmeEmail
} from "./install-traefik";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

describe("install traefik helpers", () => {
  test("injects a Traefik dashboard service and local-only DaoFlow bind", () => {
    const composeContent = buildInstallComposeContent({
      composeContent: `# docker-compose.yml — Production deployment stack
# Usage: docker compose up -d

services:
  daoflow:
    image: ghcr.io/daoflow-dev/daoflow:latest
    ports:
      - "\${DAOFLOW_PORT:-3000}:3000"
volumes:
  pgdata: {}
`,
      exposureMode: "traefik"
    });

    const doc = asRecord(parseYaml(composeContent) as unknown);
    const services = asRecord(doc.services);
    const traefik = asRecord(services.traefik);
    const daoflow = asRecord(services.daoflow);
    const networks = asRecord(doc.networks);
    const proxyNetwork = asRecord(networks["daoflow-proxy"]);
    const volumes = asRecord(doc.volumes);

    expect(traefik.image).toBe("traefik:v3.6.7");
    expect(traefik.ports).toEqual(["80:80", "443:443"]);
    expect(daoflow.ports).toEqual(["127.0.0.1:${DAOFLOW_PORT:-3000}:3000"]);
    expect(daoflow.labels).toContain("traefik.http.routers.daoflow.rule=Host(`${DAOFLOW_DOMAIN}`)");
    expect(proxyNetwork.name).toBe("${DAOFLOW_PROXY_NETWORK:-daoflow-proxy}");
    expect(asRecord(volumes["traefik-letsencrypt"])).toEqual({});
    expect(composeContent.startsWith("# docker-compose.yml — Production deployment stack")).toBe(
      true
    );
  });

  test("preserves inline comments outside the rewritten Traefik fields", () => {
    const composeContent = buildInstallComposeContent({
      composeContent: `services:
  daoflow: # keep service comment
    image: ghcr.io/daoflow-dev/daoflow:latest # keep image comment
    ports:
      - "\${DAOFLOW_PORT:-3000}:3000" # keep port comment
volumes:
  pgdata: {} # keep volume comment
`,
      exposureMode: "traefik"
    });

    expect(composeContent).toContain("# keep service comment");
    expect(composeContent).toContain("# keep image comment");
    expect(composeContent).toContain("# keep volume comment");
  });

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
