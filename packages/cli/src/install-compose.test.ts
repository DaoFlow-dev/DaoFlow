import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { buildInstallComposeContent } from "./install-compose";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

describe("install compose helpers", () => {
  test("injects a Traefik dashboard service, preserves default networking, and binds DaoFlow locally", () => {
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
    expect(daoflow.networks).toEqual(["default", "daoflow-proxy"]);
    expect(daoflow.labels).toContain("traefik.http.routers.daoflow.rule=Host(`${DAOFLOW_DOMAIN}`)");
    expect(proxyNetwork.name).toBe("${DAOFLOW_PROXY_NETWORK:-daoflow-proxy}");
    expect(asRecord(volumes["traefik-letsencrypt"])).toEqual({});
    expect(composeContent.startsWith("# docker-compose.yml — Production deployment stack")).toBe(
      true
    );
  });

  test("preserves inline comments outside the rewritten install-managed fields", () => {
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

  test("injects a Cloudflare Tunnel sidecar with an env-backed token and keeps DaoFlow bound to localhost", () => {
    const composeContent = buildInstallComposeContent({
      composeContent: `services:
  daoflow:
    image: ghcr.io/daoflow-dev/daoflow:latest
    ports:
      - "\${DAOFLOW_PORT:-3000}:3000"
`,
      exposureMode: "none",
      cloudflareTunnelEnabled: true
    });

    const doc = asRecord(parseYaml(composeContent) as unknown);
    const services = asRecord(doc.services);
    const cloudflared = asRecord(services.cloudflared);
    const daoflow = asRecord(services.daoflow);

    expect(cloudflared.image).toBe("cloudflare/cloudflared:latest");
    expect(cloudflared.command).toEqual(["tunnel", "--no-autoupdate", "run"]);
    expect(asRecord(cloudflared.environment)).toEqual({
      TUNNEL_TOKEN: "${CLOUDFLARE_TUNNEL_TOKEN}"
    });
    expect(daoflow.ports).toEqual(["127.0.0.1:${DAOFLOW_PORT:-3000}:3000"]);
  });

  test("keeps DaoFlow reachable from Cloudflare when Traefik and Cloudflare are both enabled", () => {
    const composeContent = buildInstallComposeContent({
      composeContent: `services:
  daoflow:
    image: ghcr.io/daoflow-dev/daoflow:latest
    ports:
      - "\${DAOFLOW_PORT:-3000}:3000"
`,
      exposureMode: "traefik",
      cloudflareTunnelEnabled: true
    });

    const doc = asRecord(parseYaml(composeContent) as unknown);
    const services = asRecord(doc.services);
    const daoflow = asRecord(services.daoflow);

    expect(services.traefik).toBeDefined();
    expect(services.cloudflared).toBeDefined();
    expect(daoflow.networks).toEqual(["default", "daoflow-proxy"]);
  });
});
