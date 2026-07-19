import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { deployments } from "./db/schema/deployments";
import { services } from "./db/schema/services";
import { reconcileIncompleteCommandAudits } from "./db/services/command-audit-reconciliation";
import { createDeploymentRecord } from "./db/services/deployments";
import { asRecord, readString } from "./db/services/json-helpers";
import { appRouter } from "./router";
import { makeSession, makeTokenAuthContext } from "./testing/request-auth-fixtures";
import { resetTestDatabaseWithControlPlane } from "./test-db";

describe("command audit boundary", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("records invalid, denied, and successful command attempts before dispatch", async () => {
    const owner = appRouter.createCaller({
      requestId: "audit-invalid",
      session: makeSession("owner")
    });
    await expect(
      owner.registerServer({ name: "missing-required-fields" } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const scopedOwner = appRouter.createCaller({
      requestId: "audit-denied",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["deploy:read"])
    });
    await expect(
      scopedOwner.registerServer({
        name: "scope-denied",
        host: "203.0.113.55",
        sshUser: "root",
        sshPort: 22,
        region: "local-test",
        kind: "docker-engine"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const successfulOwner = appRouter.createCaller({
      requestId: "audit-success",
      session: makeSession("owner")
    });
    await successfulOwner.registerServer({
      name: "audit-success",
      host: "203.0.113.56",
      sshUser: "root",
      sshPort: 22,
      region: "local-test",
      kind: "docker-engine"
    });

    const rows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "command.registerServer"))
      .orderBy(asc(auditEntries.id));
    const byRequest = new Map<string, string[]>();

    for (const row of rows) {
      const requestId = readString(asRecord(row.metadata), "requestId");
      byRequest.set(requestId, [...(byRequest.get(requestId) ?? []), row.outcome]);
    }

    expect(byRequest.get("audit-invalid")).toEqual(["attempted", "validation_failed"]);
    expect(byRequest.get("audit-denied")).toEqual(["attempted", "denied"]);
    expect(byRequest.get("audit-success")).toEqual(["attempted", "succeeded"]);
    expect(byRequest.get("audit-invalid")).not.toContain("succeeded");
    expect(byRequest.get("audit-denied")).not.toContain("succeeded");
    expect(rows.every((row) => asRecord(row.metadata).immutable === true)).toBe(true);
  });

  it("records malformed transport input before the tRPC adapter can parse it", async () => {
    const response = await createApp().request("/trpc/registerServer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "audit-malformed-transport"
      },
      body: "{"
    });
    const rows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "command.registerServer"))
      .orderBy(asc(auditEntries.id));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rows.map((row) => row.outcome)).toEqual(["attempted", "validation_failed"]);
  });

  it("marks old attempts incomplete without inventing remote success", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    await db.insert(auditEntries).values({
      actorType: "user",
      actorId: "user_foundation_owner",
      actorEmail: "owner@daoflow.local",
      actorRole: "owner",
      organizationId: "team_foundation",
      targetResource: "service/svc_reconcile",
      action: "command.triggerDeploy",
      permissionScope: "deploy:start",
      outcome: "attempted",
      metadata: {
        immutable: true,
        commandAuditVersion: 1,
        attemptId: "audit_reconcile_attempt_1",
        phase: "intent",
        requestId: "audit-reconcile"
      },
      createdAt: new Date(now.getTime() - 10 * 60 * 1000)
    });

    const first = await reconcileIncompleteCommandAudits({ now });
    const second = await reconcileIncompleteCommandAudits({ now });
    const rows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "command.triggerDeploy"))
      .orderBy(asc(auditEntries.id));

    expect(first).toEqual({ eligibleCount: 1, reconciledCount: 1 });
    expect(second).toEqual({ eligibleCount: 0, reconciledCount: 0 });
    expect(rows.map((row) => row.outcome)).toEqual(["attempted", "incomplete"]);
    expect(rows.some((row) => row.outcome === "succeeded")).toBe(false);
  });

  it("records queued work as accepted and links the returned deployment", async () => {
    const caller = appRouter.createCaller({
      requestId: "audit-accepted-deployment",
      session: makeSession("owner")
    });
    const inventory = await caller.infrastructureInventory();
    const server = inventory.servers[0];
    if (!server) {
      throw new Error("Expected a seeded server for command audit correlation.");
    }
    await db.insert(services).values({
      id: "svc_audit_link",
      name: "audit-link",
      slug: "audit-link",
      projectId: "proj_daoflow_control_plane",
      environmentId: "env_daoflow_staging",
      targetServerId: server.id,
      sourceType: "compose",
      status: "inactive"
    });
    const deployment = await caller.createDeploymentRecord({
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "audit-link",
      sourceType: "compose",
      targetServerId: server.id,
      commitSha: "abcdef1",
      imageTag: "ghcr.io/daoflow/audit-link:abcdef1",
      steps: [{ label: "Deploy", detail: "Queue the audited deployment." }]
    });
    const rows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "command.createDeploymentRecord"))
      .orderBy(asc(auditEntries.id));
    const outcome = rows.find((row) => row.outcome === "accepted");

    expect(rows.map((row) => row.outcome)).toEqual(["attempted", "accepted"]);
    expect(readString(asRecord(outcome?.metadata), "operationId")).toBe(deployment.id);
  });

  it("reconciles a missing audit write from durable deployment state", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const attemptId = "audit_remote_reconcile_1";
    const caller = appRouter.createCaller({
      requestId: "audit-remote-reconcile-fixture",
      session: makeSession("owner")
    });
    const inventory = await caller.infrastructureInventory();
    const server = inventory.servers[0];
    if (!server) throw new Error("Expected a seeded server for remote audit reconciliation.");

    await db.insert(services).values({
      id: "svc_audit_reconcile",
      name: "audit-reconcile",
      slug: "audit-reconcile",
      projectId: "proj_daoflow_control_plane",
      environmentId: "env_daoflow_staging",
      targetServerId: server.id,
      sourceType: "compose",
      status: "inactive"
    });

    await db.insert(auditEntries).values({
      actorType: "user",
      actorId: "user_foundation_owner",
      actorEmail: "owner@daoflow.local",
      actorRole: "owner",
      organizationId: "team_foundation",
      targetResource: "command/createDeploymentRecord",
      action: "command.createDeploymentRecord",
      permissionScope: "deploy:start",
      outcome: "attempted",
      metadata: {
        immutable: true,
        commandAuditVersion: 1,
        attemptId,
        phase: "intent",
        requestId: "audit-remote-reconcile"
      },
      createdAt: new Date(now.getTime() - 10 * 60 * 1000)
    });
    const deployment = await createDeploymentRecord({
      serviceId: "svc_audit_reconcile",
      projectName: "DaoFlow",
      environmentName: "staging",
      serviceName: "audit-reconcile",
      sourceType: "compose",
      targetServerId: server.id,
      teamId: "team_foundation",
      commitSha: "abcdef2",
      imageTag: "ghcr.io/daoflow/audit-reconcile:abcdef2",
      commandAuditAttemptId: attemptId,
      steps: [{ label: "Queue", detail: "Create durable operation evidence." }]
    });
    if (!deployment) throw new Error("Expected deployment reconciliation fixture.");

    expect(await reconcileIncompleteCommandAudits({ now })).toEqual({
      eligibleCount: 1,
      reconciledCount: 1
    });
    await db
      .update(deployments)
      .set({ status: "completed", conclusion: "succeeded", updatedAt: now })
      .where(eq(deployments.id, deployment.id));
    expect(
      await reconcileIncompleteCommandAudits({ now: new Date(now.getTime() + 60_000) })
    ).toEqual({ eligibleCount: 1, reconciledCount: 1 });

    const rows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "command.createDeploymentRecord"))
      .orderBy(asc(auditEntries.id));
    expect(rows.map((row) => row.outcome)).toEqual(["attempted", "accepted", "succeeded"]);
    expect(rows.slice(1).map((row) => readString(asRecord(row.metadata), "operationId"))).toEqual([
      deployment.id,
      deployment.id
    ]);
  });

  it("prevents immutable command audit rows from being rewritten or deleted", async () => {
    const [entry] = await db
      .insert(auditEntries)
      .values({
        actorType: "user",
        actorId: "user_foundation_owner",
        actorEmail: "owner@daoflow.local",
        actorRole: "owner",
        targetResource: "service/svc_immutable",
        action: "command.updateService",
        permissionScope: "service:update",
        outcome: "attempted",
        metadata: {
          immutable: true,
          commandAuditVersion: 1,
          attemptId: "audit_immutable_attempt_1",
          phase: "intent"
        }
      })
      .returning({ id: auditEntries.id });

    expect(entry).toBeDefined();
    if (!entry) throw new Error("Expected immutable audit entry to be inserted.");
    await expect(
      db.update(auditEntries).set({ outcome: "succeeded" }).where(eq(auditEntries.id, entry.id))
    ).rejects.toThrow(/failed query/i);
    await expect(db.delete(auditEntries).where(eq(auditEntries.id, entry.id))).rejects.toThrow(
      /failed query/i
    );

    const [unchanged] = await db.select().from(auditEntries).where(eq(auditEntries.id, entry.id));
    expect(unchanged?.outcome).toBe("attempted");
  });
});
