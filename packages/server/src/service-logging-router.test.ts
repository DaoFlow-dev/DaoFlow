import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { servers } from "./db/schema/servers";
import { services } from "./db/schema/services";
import { teams } from "./db/schema/teams";
import { asRecord } from "./db/services/json-helpers";
import { appRouter } from "./router";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { createProjectEnvironmentServiceFixture } from "./testing/project-fixtures";
import { makeSession, makeTokenAuthContext } from "./testing/request-auth-fixtures";

let fixtureCount = 0;

async function createComposeServiceFixture() {
  fixtureCount += 1;
  const suffix = `${Date.now()}_${fixtureCount}`;
  return createProjectEnvironmentServiceFixture({
    project: {
      name: `logging-router-project-${suffix}`,
      description: "Managed logging router test",
      teamId: "team_foundation"
    },
    environment: {
      name: `logging-router-env-${suffix}`,
      targetServerId: "srv_foundation_1"
    },
    service: {
      name: `logging-router-service-${suffix}`,
      sourceType: "compose",
      composeServiceName: "api",
      targetServerId: "srv_foundation_1"
    }
  });
}

describe("service logging tRPC routes", () => {
  beforeEach(async () => {
    fixtureCount = 0;
    await resetTestDatabaseWithControlPlane();
  });

  it("previews without mutation, updates normalized logging, and audits old and new values", async () => {
    const fixture = await createComposeServiceFixture();
    const caller = appRouter.createCaller({
      requestId: "service-logging-preview",
      session: makeSession("owner")
    });
    const [before] = await db
      .select({ config: services.config })
      .from(services)
      .where(eq(services.id, fixture.service.id));

    const preview = await caller.previewServiceLoggingConfig({
      serviceId: fixture.service.id,
      logging: { maxSizeMb: 64, maxFiles: 4 }
    });

    expect(preview.logging).toEqual({
      managed: true,
      driver: "json-file",
      maxSizeMb: 64,
      maxFiles: 4,
      allowSourceOverride: false
    });
    expect(preview.runtimeConfig).toMatchObject({ logging: preview.logging });
    expect(preview.runtimeConfigPreview).toContain("max-size: 64m");

    const [afterPreview] = await db
      .select({ config: services.config })
      .from(services)
      .where(eq(services.id, fixture.service.id));
    expect(afterPreview?.config).toEqual(before?.config);

    const updated = await caller.updateServiceRuntimeConfig({
      serviceId: fixture.service.id,
      logging: { maxSizeMb: 64, maxFiles: 4 }
    });
    expect(updated.runtimeConfig?.logging).toEqual(preview.logging);

    const changed = await caller.updateServiceRuntimeConfig({
      serviceId: fixture.service.id,
      logging: { maxSizeMb: 128, maxFiles: 2, allowSourceOverride: true }
    });
    expect(changed.runtimeConfig?.logging).toEqual({
      managed: true,
      driver: "json-file",
      maxSizeMb: 128,
      maxFiles: 2,
      allowSourceOverride: true
    });

    const audits = await db
      .select({ metadata: auditEntries.metadata })
      .from(auditEntries)
      .where(eq(auditEntries.action, "service.runtime-config.update"))
      .orderBy(auditEntries.id);
    expect(asRecord(audits.at(-1)?.metadata).logging).toEqual({
      previous: preview.logging,
      next: changed.runtimeConfig?.logging
    });
    expect(asRecord(audits[0]?.metadata).logging).toEqual({
      previous: null,
      next: preview.logging
    });

    const removalPreview = await caller.previewServiceLoggingConfig({
      serviceId: fixture.service.id,
      logging: null
    });
    expect(removalPreview.logging).toBeNull();
    expect(removalPreview.runtimeConfig).toBeNull();
  });

  it("enforces exact diagnostics and deploy read scopes, and returns the safe not-deployed contract", async () => {
    const fixture = await createComposeServiceFixture();
    const owner = appRouter.createCaller({
      requestId: "service-logging-owner-update",
      session: makeSession("owner")
    });
    await owner.updateServiceRuntimeConfig({
      serviceId: fixture.service.id,
      logging: { maxSizeMb: 10, maxFiles: 3 }
    });

    const diagnosticsCaller = appRouter.createCaller({
      requestId: "service-logging-diagnostics",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["diagnostics:read"])
    });
    const state = await diagnosticsCaller.serviceLoggingState({ serviceId: fixture.service.id });
    expect(state).toMatchObject({
      service: { id: fixture.service.id, name: fixture.service.name },
      desired: {
        managed: true,
        driver: "json-file",
        maxSizeMb: 10,
        maxFiles: 3,
        allowSourceOverride: false
      },
      status: "not-deployed",
      reason: "No successful deployment exists for this service yet.",
      containers: []
    });
    expect(Number.isNaN(Date.parse(state.inspectedAt))).toBe(false);

    const deployOnlyCaller = appRouter.createCaller({
      requestId: "service-logging-deploy-only",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["deploy:read"])
    });
    await expect(
      deployOnlyCaller.serviceLoggingState({ serviceId: fixture.service.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
    await expect(
      deployOnlyCaller.previewServiceLoggingConfig({ serviceId: fixture.service.id, logging: null })
    ).resolves.toMatchObject({ logging: null });

    const diagnosticsOnlyCaller = appRouter.createCaller({
      requestId: "service-logging-diagnostics-only",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["diagnostics:read"])
    });
    await expect(
      diagnosticsOnlyCaller.previewServiceLoggingConfig({
        serviceId: fixture.service.id,
        logging: null
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
  });

  it("does not expose logging diagnostics or previews across teams", async () => {
    const otherTeamId = `team_logging_other_${Date.now()}`.slice(0, 32);
    const otherServerId = `srv_logging_other_${Date.now()}`.slice(0, 32);
    await db.insert(teams).values({
      id: otherTeamId,
      name: "Logging isolation team",
      slug: `logging-isolation-${Date.now()}`.slice(0, 40),
      status: "active",
      createdByUserId: "user_foundation_owner",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await db.insert(servers).values({
      id: otherServerId,
      name: "Logging isolation server",
      host: "198.51.100.91",
      region: "test",
      teamId: otherTeamId,
      sshPort: 22,
      kind: "docker-engine",
      status: "pending host identity approval",
      metadata: {},
      registeredByUserId: "user_foundation_owner",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const fixture = await createProjectEnvironmentServiceFixture({
      project: {
        name: `logging-isolation-project-${Date.now()}`,
        description: "Cross-team logging test",
        teamId: otherTeamId
      },
      environment: {
        teamId: otherTeamId,
        name: `logging-isolation-env-${Date.now()}`,
        targetServerId: otherServerId
      },
      service: {
        name: `logging-isolation-service-${Date.now()}`,
        sourceType: "compose",
        composeServiceName: "api",
        targetServerId: otherServerId
      }
    });

    const caller = appRouter.createCaller({
      requestId: "service-logging-cross-team",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["diagnostics:read", "deploy:read"])
    });
    await expect(
      caller.serviceLoggingState({ serviceId: fixture.service.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<TRPCError>);
    await expect(
      caller.previewServiceLoggingConfig({ serviceId: fixture.service.id, logging: null })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<TRPCError>);

    const denied = await db
      .select({ action: auditEntries.action, permissionScope: auditEntries.permissionScope })
      .from(auditEntries)
      .where(eq(auditEntries.outcome, "denied"));
    expect(denied).toEqual(
      expect.arrayContaining([
        { action: "service.logging-state.denied", permissionScope: "diagnostics:read" },
        { action: "service.logging-preview.denied", permissionScope: "deploy:read" }
      ])
    );
  });
});
