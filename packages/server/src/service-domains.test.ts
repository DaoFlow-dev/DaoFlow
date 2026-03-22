import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/connection";
import { tunnelRoutes, tunnels } from "./db/schema/tunnels";
import { asRecord, newId } from "./db/services/json-helpers";
import { appRouter } from "./router";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { createProjectEnvironmentServiceFixture } from "./testing/project-fixtures";
import { makeSession } from "./testing/request-auth-fixtures";

async function createServiceDomainFixture(suffix: string) {
  const fixture = await createProjectEnvironmentServiceFixture({
    project: {
      name: `service-domains-${suffix}`,
      description: "Service domain test fixture",
      teamId: "team_foundation"
    },
    environment: {
      name: `domains-env-${suffix}`,
      targetServerId: "srv_foundation_1"
    },
    service: {
      name: `domains-svc-${suffix}`,
      sourceType: "compose",
      composeServiceName: "api",
      targetServerId: "srv_foundation_1"
    }
  });

  return {
    projectId: fixture.project.id,
    service: fixture.service
  };
}

describe("service domain workflows", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("persists desired domains and port mappings with observed route reconciliation", async () => {
    const suffix = `${Date.now()}`;
    const caller = appRouter.createCaller({
      requestId: `test-service-domains-${suffix}`,
      session: makeSession("owner")
    });
    const fixture = await createServiceDomainFixture(suffix);
    const primaryHostname = `app-${suffix}.example.com`;
    const secondaryHostname = `api-${suffix}.example.com`;

    const firstState = await caller.addServiceDomain({
      serviceId: fixture.service.id,
      hostname: primaryHostname.toUpperCase()
    });

    expect(firstState.summary.primaryDomain).toBe(primaryHostname);
    expect(firstState.domains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hostname: primaryHostname,
          isPrimary: true,
          proxyStatus: "missing",
          tlsStatus: "pending"
        })
      ])
    );

    const secondState = await caller.addServiceDomain({
      serviceId: fixture.service.id,
      hostname: secondaryHostname
    });
    const secondDomain = secondState.domains.find(
      (domain) => domain.hostname === secondaryHostname
    );
    expect(secondDomain).toBeTruthy();
    if (!secondDomain) {
      throw new Error("Second domain was not created.");
    }

    await caller.setPrimaryServiceDomain({
      serviceId: fixture.service.id,
      domainId: secondDomain.id
    });

    const afterRemoval = await caller.removeServiceDomain({
      serviceId: fixture.service.id,
      domainId: secondDomain.id
    });
    expect(afterRemoval.summary.primaryDomain).toBe(primaryHostname);
    expect(afterRemoval.domains).toHaveLength(1);

    const portsState = await caller.updateServicePortMappings({
      serviceId: fixture.service.id,
      portMappings: [
        {
          hostPort: 443,
          containerPort: 3000,
          protocol: "tcp"
        }
      ]
    });
    expect(portsState.portMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hostPort: 443,
          containerPort: 3000,
          protocol: "tcp"
        })
      ])
    );

    const tunnelId = newId();
    await db.insert(tunnels).values({
      id: tunnelId,
      name: `edge-${suffix}`.slice(0, 100),
      teamId: "team_foundation",
      tunnelId: `cf-${suffix}`.slice(0, 80),
      credentialsEncrypted: null,
      domain: "example.com",
      status: "active",
      config: {}
    });
    await db.insert(tunnelRoutes).values({
      id: newId(),
      tunnelId,
      hostname: primaryHostname,
      service: fixture.service.name,
      path: null,
      status: "active"
    });

    const observedState = await caller.serviceDomainState({
      serviceId: fixture.service.id
    });
    expect(observedState.summary).toMatchObject({
      primaryDomain: primaryHostname,
      desiredDomainCount: 1,
      matchedDomainCount: 1,
      missingDomainCount: 0
    });
    const observedPrimary = observedState.domains.find(
      (domain) => domain.hostname === primaryHostname
    );
    expect(observedPrimary).toMatchObject({
      hostname: primaryHostname,
      proxyStatus: "matched",
      tlsStatus: "ready"
    });
    expect(observedPrimary?.observedRoute).toMatchObject({
      hostname: primaryHostname,
      service: fixture.service.name
    });

    const details = await caller.serviceDetails({
      serviceId: fixture.service.id
    });
    expect(details.domainConfig).toMatchObject({
      domains: [
        {
          hostname: primaryHostname,
          isPrimary: true
        }
      ],
      portMappings: [
        {
          hostPort: 443,
          containerPort: 3000,
          protocol: "tcp"
        }
      ]
    });
    expect(asRecord(details.config).domainConfig).toMatchObject({
      domains: [
        {
          hostname: primaryHostname,
          isPrimary: true
        }
      ]
    });
  });

  it("rejects invalid hostnames and duplicate published host ports", async () => {
    const suffix = `${Date.now()}_validation`;
    const caller = appRouter.createCaller({
      requestId: `test-service-domains-validation-${suffix}`,
      session: makeSession("owner")
    });
    const fixture = await createServiceDomainFixture(suffix);

    await expect(
      caller.addServiceDomain({
        serviceId: fixture.service.id,
        hostname: "*.example.com"
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);

    await expect(
      caller.updateServicePortMappings({
        serviceId: fixture.service.id,
        portMappings: [
          {
            hostPort: 443,
            containerPort: 3000,
            protocol: "tcp"
          },
          {
            hostPort: 443,
            containerPort: 8080,
            protocol: "tcp"
          }
        ]
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
  });
});
