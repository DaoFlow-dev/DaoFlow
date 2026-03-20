import { describe, expect, it } from "vitest";
import {
  normalizeServiceDomainHostname,
  readServiceDomainConfigFromConfig,
  writeServiceDomainConfigToConfig
} from "./service-domain-config";

describe("service domain config", () => {
  it("normalizes persisted domains and port mappings into config storage", () => {
    const config = writeServiceDomainConfigToConfig({
      config: {},
      patch: {
        domains: [
          {
            id: "dom_primary",
            hostname: "App.Example.com.",
            isPrimary: true,
            createdAt: "2026-03-20T12:00:00.000Z"
          },
          {
            id: "dom_duplicate",
            hostname: "app.example.com",
            isPrimary: false,
            createdAt: "2026-03-20T12:01:00.000Z"
          },
          {
            id: "dom_www",
            hostname: "www.example.com",
            isPrimary: true,
            createdAt: "2026-03-20T12:02:00.000Z"
          }
        ],
        portMappings: [
          {
            id: "pm_1",
            hostPort: 80,
            containerPort: 3000,
            protocol: "tcp",
            createdAt: "2026-03-20T12:00:00.000Z"
          },
          {
            id: "pm_duplicate",
            hostPort: 80,
            containerPort: 8080,
            protocol: "tcp",
            createdAt: "2026-03-20T12:01:00.000Z"
          },
          {
            id: "pm_2",
            hostPort: 443,
            containerPort: 3000,
            protocol: "udp",
            createdAt: "2026-03-20T12:02:00.000Z"
          }
        ]
      }
    });

    expect(readServiceDomainConfigFromConfig(config)).toEqual({
      domains: [
        {
          id: "dom_primary",
          hostname: "app.example.com",
          isPrimary: true,
          createdAt: "2026-03-20T12:00:00.000Z"
        },
        {
          id: "dom_www",
          hostname: "www.example.com",
          isPrimary: false,
          createdAt: "2026-03-20T12:02:00.000Z"
        }
      ],
      portMappings: [
        {
          id: "pm_1",
          hostPort: 80,
          containerPort: 3000,
          protocol: "tcp",
          createdAt: "2026-03-20T12:00:00.000Z"
        },
        {
          id: "pm_2",
          hostPort: 443,
          containerPort: 3000,
          protocol: "udp",
          createdAt: "2026-03-20T12:02:00.000Z"
        }
      ]
    });
  });

  it("accepts production hostnames and rejects unsupported patterns", () => {
    expect(normalizeServiceDomainHostname("App.Example.com.")).toBe("app.example.com");
    expect(normalizeServiceDomainHostname("example.com")).toBe("example.com");
    expect(normalizeServiceDomainHostname("*.example.com")).toBeNull();
    expect(normalizeServiceDomainHostname("example.com/path")).toBeNull();
    expect(normalizeServiceDomainHostname("example.com:443")).toBeNull();
    expect(normalizeServiceDomainHostname("localhost")).toBeNull();
  });
});
