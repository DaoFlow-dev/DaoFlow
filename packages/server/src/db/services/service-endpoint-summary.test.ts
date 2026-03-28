import { describe, expect, it } from "vitest";
import { buildServiceEndpointSummary } from "./service-endpoint-summary";

describe("buildServiceEndpointSummary", () => {
  it("returns a healthy summary for a single matched primary domain", () => {
    const summary = buildServiceEndpointSummary({
      serviceName: "api",
      runtimeTone: "healthy",
      domainConfig: {
        domains: [
          {
            id: "dom_primary",
            hostname: "app.example.com",
            isPrimary: true,
            createdAt: "2026-03-28T00:00:00.000Z"
          }
        ],
        portMappings: []
      },
      observedRoutesByHostname: new Map([
        [
          "app.example.com",
          {
            hostname: "app.example.com",
            service: "api",
            path: null,
            status: "active",
            tunnelName: "edge-prod"
          }
        ]
      ])
    });

    expect(summary).toMatchObject({
      status: "healthy",
      primaryLabel: "Primary domain",
      primaryHref: "https://app.example.com"
    });
    expect(summary.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "domain",
          copyValue: "https://app.example.com",
          status: "healthy"
        })
      ])
    );
  });

  it("returns many surfaced links when a service has domains and published ports", () => {
    const summary = buildServiceEndpointSummary({
      serviceName: "api",
      runtimeTone: "healthy",
      targetServerHost: "203.0.113.24",
      targetServerName: "foundation",
      domainConfig: {
        domains: [
          {
            id: "dom_primary",
            hostname: "app.example.com",
            isPrimary: true,
            createdAt: "2026-03-28T00:00:00.000Z"
          },
          {
            id: "dom_secondary",
            hostname: "api.example.com",
            isPrimary: false,
            createdAt: "2026-03-28T00:00:01.000Z"
          }
        ],
        portMappings: [
          {
            id: "port_443",
            hostPort: 443,
            containerPort: 3000,
            protocol: "tcp",
            createdAt: "2026-03-28T00:00:02.000Z"
          }
        ]
      },
      observedRoutesByHostname: new Map([
        [
          "app.example.com",
          {
            hostname: "app.example.com",
            service: "api",
            path: null,
            status: "active",
            tunnelName: "edge-prod"
          }
        ]
      ])
    });

    expect(summary.links).toHaveLength(3);
    expect(summary.links.map((link) => link.label)).toEqual([
      "Primary domain",
      "Additional domain",
      "Published TCP 443"
    ]);
    expect(summary.links[1]).toMatchObject({
      kind: "domain",
      status: "pending"
    });
    expect(summary.links[2]).toMatchObject({
      kind: "port",
      copyValue: "203.0.113.24:443/tcp",
      status: "healthy"
    });
  });

  it("reports no external link when only an internal service port exists", () => {
    const summary = buildServiceEndpointSummary({
      serviceName: "worker",
      runtimeTone: "healthy",
      servicePort: "3000",
      healthcheckPath: "/health",
      domainConfig: null
    });

    expect(summary).toMatchObject({
      status: "unavailable",
      primaryLabel: null,
      primaryHref: null
    });
    expect(summary.summary).toContain("No public endpoint is configured");
    expect(summary.summary).toContain("container port 3000");
    expect(summary.links).toEqual([]);
  });
});
