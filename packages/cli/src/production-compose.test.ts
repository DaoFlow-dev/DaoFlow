import { describe, expect, test } from "bun:test";
import dockerignore from "@balena/dockerignore";
import { parse as parseYaml } from "yaml";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveServiceNames(
  services: Record<string, unknown>,
  activeProfiles: string[]
): string[] {
  const active = new Set(activeProfiles);
  return Object.entries(services)
    .filter(([, service]) => {
      const profiles = asRecord(service).profiles;
      return (
        !Array.isArray(profiles) ||
        profiles.length === 0 ||
        profiles.some((profile) => typeof profile === "string" && active.has(profile))
      );
    })
    .map(([name]) => name);
}

describe("production docker-compose.yml", () => {
  test("builds the application runtime by default instead of the development-task runner", async () => {
    const dockerfile = await Bun.file(new URL("../../../Dockerfile", import.meta.url)).text();
    const stages = dockerfile
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("FROM "));

    expect(stages.at(-1)).toBe("FROM runtime AS production");
  });

  test("keeps local secrets out of the Docker build context", async () => {
    const dockerignoreContent = await Bun.file(
      new URL("../../../.dockerignore", import.meta.url)
    ).text();
    const matcher = dockerignore().add(dockerignoreContent.split(/\r?\n/));

    for (const secretPath of [".env", ".env.local", "nested/.env", "nested/.env.production"]) {
      expect(matcher.ignores(secretPath)).toBe(true);
    }

    for (const examplePath of [".env.example", "nested/.env.example"]) {
      expect(matcher.ignores(examplePath)).toBe(false);
    }
  });

  test("keeps production runtime defaults hardened", async () => {
    const composeContent = await Bun.file(
      new URL("../../../docker-compose.yml", import.meta.url)
    ).text();
    const doc = asRecord(parseYaml(composeContent) as unknown);
    const services = asRecord(doc.services);
    const daoflow = asRecord(services.daoflow);
    const temporal = asRecord(services.temporal);
    const temporalPostgres = asRecord(services["temporal-postgresql"]);
    const temporalUi = asRecord(services["temporal-ui"]);

    const images = Object.values(services)
      .map((service) => asRecord(service).image)
      .filter((image): image is string => typeof image === "string");

    expect(images.filter((image) => image.endsWith(":latest"))).toEqual([]);
    expect(images).not.toContain("temporalio/auto-setup:latest");
    expect(images).not.toContain("ghcr.io/daoflow-dev/daoflow:${DAOFLOW_VERSION:-latest}");
    expect(daoflow.image).toBe("ghcr.io/daoflow-dev/daoflow:${DAOFLOW_VERSION:-0.10.0}");
    expect(daoflow.ports).toEqual(["${DAOFLOW_BIND:-127.0.0.1}:${DAOFLOW_PORT:-3000}:3000"]);
    expect(asRecord(daoflow.environment).DATABASE_URL).toBe(
      "postgresql://daoflow:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@postgres:5432/${DAOFLOW_DATABASE_NAME:-daoflow}"
    );
    expect(asRecord(daoflow.environment).BETTER_AUTH_SECRET).toBe(
      "${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET in .env}"
    );
    expect(asRecord(daoflow.environment).ENCRYPTION_KEY).toBe(
      "${ENCRYPTION_KEY:?Set ENCRYPTION_KEY in .env}"
    );
    expect(asRecord(daoflow.environment).DAOFLOW_RECOVERY_ENCRYPTION_KEY).toBe(
      "${DAOFLOW_RECOVERY_ENCRYPTION_KEY:-}"
    );
    expect(asRecord(daoflow.environment).CORS_ORIGIN).toBe("${CORS_ORIGIN:-}");
    expect(asRecord(daoflow.environment).DEPLOY_TIMEOUT_MS).toBe("${DEPLOY_TIMEOUT_MS:-86400000}");
    expect(daoflow.healthcheck).toBeDefined();
    expect(asRecord(asRecord(services.postgres).environment).POSTGRES_DB).toBe(
      "${DAOFLOW_DATABASE_NAME:-daoflow}"
    );
    expect(asRecord(asRecord(services.postgres).environment).POSTGRES_PASSWORD).toBe(
      "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}"
    );
    expect(asRecord(temporalPostgres.environment).POSTGRES_PASSWORD).toBe(
      "${TEMPORAL_POSTGRES_PASSWORD-}"
    );
    expect(temporal.environment).toContain("POSTGRES_PWD=${TEMPORAL_POSTGRES_PASSWORD-}");
    expect(temporalPostgres.profiles).toEqual(["temporal", "temporal-ui"]);
    expect(temporal.image).toBe("temporalio/auto-setup:1.29.6");
    expect(temporal.profiles).toEqual(["temporal", "temporal-ui"]);
    expect(temporal.ports).toBeUndefined();
    expect(temporal.expose).toEqual(["7233"]);
    expect(temporalUi.profiles).toEqual(["temporal-ui"]);
    expect(temporalUi.ports).toEqual(["127.0.0.1:${TEMPORAL_UI_PORT:-8233}:8080"]);
    expect(asRecord(daoflow.depends_on).temporal).toBeUndefined();
    expect(asRecord(temporal.depends_on)["temporal-postgresql"]).toEqual({
      condition: "service_healthy"
    });
  });

  test("resolves only the lean services when Temporal is disabled", async () => {
    const composeContent = await Bun.file(
      new URL("../../../docker-compose.yml", import.meta.url)
    ).text();
    const services = asRecord(asRecord(parseYaml(composeContent) as unknown).services);

    expect(resolveServiceNames(services, [])).toEqual(["daoflow", "postgres", "redis"]);
  });

  test("resolves the Temporal services only for the explicit temporal profile", async () => {
    const composeContent = await Bun.file(
      new URL("../../../docker-compose.yml", import.meta.url)
    ).text();
    const services = asRecord(asRecord(parseYaml(composeContent) as unknown).services);

    expect(resolveServiceNames(services, ["temporal"])).toEqual([
      "daoflow",
      "postgres",
      "redis",
      "temporal-postgresql",
      "temporal"
    ]);
    expect(resolveServiceNames(services, ["temporal-ui"])).toEqual([
      "daoflow",
      "postgres",
      "redis",
      "temporal-postgresql",
      "temporal",
      "temporal-ui"
    ]);
  });
});
