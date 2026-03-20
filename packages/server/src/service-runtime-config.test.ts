import { describe, expect, it } from "vitest";
import {
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
      }
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
});
