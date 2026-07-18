import { describe, expect, it, mock } from "bun:test";
import { fetchComposeYml, generateEnvFile, parseEnvFile } from "./templates";

describe("fetchComposeYml", () => {
  it("fetches release-tagged compose templates for concrete semver versions", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = ((url: string | URL | Request) => {
      urls.push(url instanceof Request ? url.url : url.toString());
      return Promise.resolve(
        new Response("services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:latest\n", {
          status: 200
        })
      );
    }) as unknown as typeof fetch;

    try {
      await fetchComposeYml("0.7.0");
      await fetchComposeYml("v0.8.0-beta.1+build.5");
      await fetchComposeYml("latest");

      expect(urls).toEqual([
        "https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/v0.7.0/docker-compose.yml",
        "https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/v0.8.0-beta.1+build.5/docker-compose.yml",
        "https://raw.githubusercontent.com/DaoFlow-dev/DaoFlow/main/docker-compose.yml"
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to the embedded compose template when the network fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(() => Promise.reject(new Error("network down")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const compose = await fetchComposeYml();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(compose).toContain("services:");
      expect(compose).toContain("daoflow:");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("generateEnvFile", () => {
  it("writes lean as the default install profile and enables Temporal only when selected", () => {
    const lean = parseEnvFile(
      generateEnvFile({
        version: "0.7.0",
        domain: "localhost",
        port: 3000
      })
    );
    const temporal = parseEnvFile(
      generateEnvFile({
        version: "0.7.0",
        domain: "localhost",
        port: 3000,
        workflowProfile: "temporal"
      })
    );

    expect(lean).toMatchObject({
      DAOFLOW_WORKFLOW_PROFILE: "lean",
      COMPOSE_PROFILES: "",
      DAOFLOW_ENABLE_TEMPORAL: "false"
    });
    expect(temporal).toMatchObject({
      DAOFLOW_WORKFLOW_PROFILE: "temporal",
      COMPOSE_PROFILES: "temporal",
      DAOFLOW_ENABLE_TEMPORAL: "true"
    });
    expect(temporal.TEMPORAL_POSTGRES_PASSWORD).not.toBe("");
  });

  it("quotes generated and preserved values that would otherwise corrupt dotenv parsing", () => {
    const envContent = generateEnvFile({
      version: "0.7.0",
      domain: "deploy.example.com",
      port: 3000,
      scheme: "https",
      exposureMode: "cloudflare-quick",
      cloudflareTunnelEnabled: true,
      cloudflareTunnelToken: "cf token #literal $HOME",
      initialAdminEmail: "owner@example.com",
      initialAdminPassword: 'pa ss #literal $HOME "quoted"',
      postgresPassword: "pg'quoted$value\\n",
      temporalPostgresPassword: "temporal value",
      authSecret: "auth secret #literal",
      encryptionKey: "enc\tkey",
      preservedEnv: {
        SMTP_PASSWORD: "smtp # secret $HOME",
        CUSTOM_VALUE: "kept'value"
      }
    });

    expect(envContent).toContain("CLOUDFLARE_TUNNEL_TOKEN='cf token #literal $HOME'");
    expect(envContent).toContain('POSTGRES_PASSWORD="pg\'quoted$$value\\\\n"');
    expect(envContent).toContain("SMTP_PASSWORD='smtp # secret $HOME'");

    const parsed = parseEnvFile(envContent);
    expect(parsed.CLOUDFLARE_TUNNEL_TOKEN).toBe("cf token #literal $HOME");
    expect(parsed.DAOFLOW_INITIAL_ADMIN_PASSWORD).toBe('pa ss #literal $HOME "quoted"');
    expect(parsed.POSTGRES_PASSWORD).toBe("pg'quoted$value\\n");
    expect(parsed.TEMPORAL_POSTGRES_PASSWORD).toBe("temporal value");
    expect(parsed.AUTH_SECRET).toBeUndefined();
    expect(parsed.BETTER_AUTH_SECRET).toBe("auth secret #literal");
    expect(parsed.ENCRYPTION_KEY).toBe("enc\tkey");
    expect(parsed.SMTP_PASSWORD).toBe("smtp # secret $HOME");
    expect(parsed.CUSTOM_VALUE).toBe("kept'value");
  });
});
