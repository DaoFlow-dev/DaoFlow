import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

describe("production docker-compose.yml", () => {
  test("keeps production runtime defaults hardened", async () => {
    const composeContent = await Bun.file(
      new URL("../../../docker-compose.yml", import.meta.url)
    ).text();
    const doc = asRecord(parseYaml(composeContent) as unknown);
    const services = asRecord(doc.services);
    const daoflow = asRecord(services.daoflow);
    const temporal = asRecord(services.temporal);
    const temporalUi = asRecord(services["temporal-ui"]);

    const images = Object.values(services)
      .map((service) => asRecord(service).image)
      .filter((image): image is string => typeof image === "string");

    expect(images.filter((image) => image.endsWith(":latest"))).toEqual([]);
    expect(images).not.toContain("temporalio/auto-setup:latest");
    expect(images).not.toContain("ghcr.io/daoflow-dev/daoflow:${DAOFLOW_VERSION:-latest}");
    expect(daoflow.image).toBe("ghcr.io/daoflow-dev/daoflow:${DAOFLOW_VERSION:-0.8.6}");
    expect(daoflow.ports).toEqual(["${DAOFLOW_BIND:-127.0.0.1}:${DAOFLOW_PORT:-3000}:3000"]);
    expect(daoflow.healthcheck).toBeDefined();
    expect(temporal.image).toBe("temporalio/auto-setup:1.29.6");
    expect(temporal.ports).toBeUndefined();
    expect(temporal.expose).toEqual(["7233"]);
    expect(temporalUi.profiles).toEqual(["temporal-ui"]);
    expect(temporalUi.ports).toEqual(["127.0.0.1:${TEMPORAL_UI_PORT:-8233}:8080"]);
  });
});
