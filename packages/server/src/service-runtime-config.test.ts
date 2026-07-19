import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { serviceRuntimeLoggingSchema } from "./routes/command-admin-service-schemas";
import {
  readServiceRuntimeConfig,
  readServiceRuntimeConfigFromConfig,
  renderServiceRuntimeOverrideComposePreview,
  writeServiceRuntimeConfigToConfig
} from "./service-runtime-config";

describe("service runtime config", () => {
  it("normalizes patches into config storage and renders a compose override preview", () => {
    const config = writeServiceRuntimeConfigToConfig({
      config: {},
      patch: {
        volumes: [
          {
            source: "/srv/data",
            target: "/var/lib/postgresql/data",
            mode: "rw"
          }
        ],
        networks: ["public"],
        restartPolicy: {
          name: "on-failure",
          maxRetries: 5
        },
        healthCheck: {
          command: "curl -f http://localhost:3000/ready || exit 1",
          intervalSeconds: 20,
          timeoutSeconds: 5,
          retries: 4,
          startPeriodSeconds: 10
        },
        resources: {
          cpuLimitCores: 1.5,
          cpuReservationCores: 0.5,
          memoryLimitMb: 768,
          memoryReservationMb: 256
        }
      }
    });

    expect(readServiceRuntimeConfigFromConfig(config)).toEqual({
      volumes: [
        {
          source: "/srv/data",
          target: "/var/lib/postgresql/data",
          mode: "rw"
        }
      ],
      networks: ["public"],
      restartPolicy: {
        name: "on-failure",
        maxRetries: 5
      },
      healthCheck: {
        command: "curl -f http://localhost:3000/ready || exit 1",
        intervalSeconds: 20,
        timeoutSeconds: 5,
        retries: 4,
        startPeriodSeconds: 10
      },
      resources: {
        cpuLimitCores: 1.5,
        cpuReservationCores: 0.5,
        memoryLimitMb: 768,
        memoryReservationMb: 256
      },
      logging: null
    });

    const preview = renderServiceRuntimeOverrideComposePreview({
      composeServiceName: "api",
      runtimeConfig: readServiceRuntimeConfigFromConfig(config)
    });

    expect(preview).toContain("services:");
    expect(preview).toContain("api:");
    expect(preview).toContain("restart: on-failure:5");
    expect(preview).toContain("curl -f http://localhost:3000/ready || exit 1");
    expect(preview).toContain('cpus: "1.5"');
    expect(preview).toContain("memory: 768M");
  });

  it("defaults managed json-file logging and renders string Docker options", () => {
    const runtimeConfig = readServiceRuntimeConfig({ logging: {} });

    expect(runtimeConfig?.logging).toEqual({
      managed: true,
      driver: "json-file",
      maxSizeMb: 10,
      maxFiles: 3,
      allowSourceOverride: false
    });

    const preview = renderServiceRuntimeOverrideComposePreview({
      composeServiceName: "api",
      runtimeConfig
    });
    const document = parseYaml(preview ?? "") as Record<string, unknown>;
    const service = (document.services as Record<string, Record<string, unknown>>).api;
    const logging = service.logging as Record<string, unknown>;

    expect(logging.driver).toBe("json-file");
    expect(logging.options).toEqual({ "max-size": "10m", "max-file": "3" });
  });

  it("rejects invalid independent and total managed logging retention bounds", () => {
    expect(serviceRuntimeLoggingSchema.safeParse({ maxSizeMb: 0, maxFiles: 3 }).success).toBe(
      false
    );
    expect(serviceRuntimeLoggingSchema.safeParse({ maxSizeMb: 10, maxFiles: 21 }).success).toBe(
      false
    );

    const retentionCap = serviceRuntimeLoggingSchema.safeParse({
      maxSizeMb: 1_024,
      maxFiles: 5
    });
    expect(retentionCap.success).toBe(false);
    if (!retentionCap.success) {
      expect(retentionCap.error.issues[0]?.message).toContain("cannot exceed 4096 MB");
    }

    expect(
      readServiceRuntimeConfig({
        logging: { maxSizeMb: 1_024, maxFiles: 5 }
      })
    ).toBeNull();
  });
});
