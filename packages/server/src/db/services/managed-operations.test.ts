import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { logDrainDeliveries } from "../schema/log-drains";
import { tunnelRoutes } from "../schema/tunnels";
import { resetSeededTestDatabase } from "../../test-db";
import {
  createLogDrain,
  resetLogDrainFetchForTests,
  retryLogDrainDelivery,
  setLogDrainFetchForTests,
  testLogDrain
} from "./log-drains";
import {
  createManagedTunnel,
  rotateManagedTunnelCredentials,
  syncManagedTunnelRoutes
} from "./tunnels";

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

describe("managed operations services", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
  });

  afterEach(() => {
    resetLogDrainFetchForTests();
  });

  it("registers tunnels, syncs observed routes, and audits credential rotation", async () => {
    const tunnel = await createManagedTunnel({
      teamId: "team_foundation",
      name: "edge",
      domain: "example.com",
      credentials: '{"token":"secret"}',
      actor
    });

    const synced = await syncManagedTunnelRoutes({
      teamId: "team_foundation",
      tunnelId: tunnel.id,
      routes: [{ hostname: "app.example.com", service: "web:3000" }],
      actor
    });
    await rotateManagedTunnelCredentials({
      teamId: "team_foundation",
      tunnelId: tunnel.id,
      credentials: '{"token":"next"}',
      actor
    });

    expect(tunnel.hasCredentials).toBe(true);
    expect(synced?.routes).toHaveLength(1);
    const routes = await db.select().from(tunnelRoutes).where(eq(tunnelRoutes.tunnelId, tunnel.id));
    expect(routes[0]).toMatchObject({ hostname: "app.example.com", service: "web:3000" });

    const audits = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `tunnel/${tunnel.id}`));
    expect(audits.map((entry) => entry.action)).toEqual([
      "tunnel.create",
      "tunnel.routes.sync",
      "tunnel.credentials.rotate"
    ]);
  });

  it("records failed log drain tests and retries with durable deliveries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    setLogDrainFetchForTests(fetchMock as unknown as typeof fetch);

    const drain = await createLogDrain({
      teamId: "team_foundation",
      name: "ops",
      destinationType: "generic_http",
      endpointUrl: "https://logs.example.com/ingest",
      headers: { Authorization: "Bearer secret" },
      actor
    });
    const first = await testLogDrain({ teamId: "team_foundation", drainId: drain.id, actor });
    expect(first?.delivery.status).toBe("failed");
    const retry = await retryLogDrainDelivery({
      teamId: "team_foundation",
      deliveryId: first!.delivery.id,
      actor
    });
    expect(retry?.delivery.status).toBe("delivered");

    const deliveries = await db
      .select()
      .from(logDrainDeliveries)
      .where(eq(logDrainDeliveries.drainId, drain.id));
    expect(deliveries.map((delivery) => delivery.status)).toEqual(["failed", "delivered"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
