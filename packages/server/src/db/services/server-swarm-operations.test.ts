import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { serverOperations } from "../schema/server-operations";
import { servers } from "../schema/servers";
import { teams } from "../schema/teams";
import { users } from "../schema/users";
import { resetTestDatabase } from "../../test-db";
import {
  planNodeAvailability,
  planServiceScale,
  updateNodeAvailability
} from "./server-swarm-operations";

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};
const teamId = "team_foundation";

describe("server swarm operations service", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(users).values({
      id: actor.requestedByUserId,
      email: actor.requestedByEmail,
      name: "Foundation Owner",
      username: "foundation-owner",
      emailVerified: true,
      role: actor.requestedByRole,
      status: "active"
    });
    await db.insert(teams).values({
      id: teamId,
      name: "Foundation",
      slug: "foundation",
      createdByUserId: actor.requestedByUserId
    });
    await db.insert(servers).values({
      id: "srv_foundation_1",
      name: "foundation",
      host: "10.0.0.10",
      kind: "docker-engine",
      status: "ready",
      teamId,
      registeredByUserId: actor.requestedByUserId
    });
  });

  it("rejects swarm operations for non-swarm targets", async () => {
    const result = await planNodeAvailability({
      serverId: "srv_foundation_1",
      teamId,
      node: "worker-a",
      availability: "drain",
      actor
    });

    expect(result).toMatchObject({
      status: "unsupported",
      message: "Server is not a Docker Swarm manager."
    });
  });

  it("records dry-run node and scale plans as server operations", async () => {
    await db
      .update(servers)
      .set({ kind: "docker-swarm-manager" })
      .where(eq(servers.id, "srv_foundation_1"));

    const nodePlan = await planNodeAvailability({
      serverId: "srv_foundation_1",
      teamId,
      node: "worker-a",
      availability: "drain",
      actor
    });
    const scalePlan = await planServiceScale({
      serverId: "srv_foundation_1",
      teamId,
      service: "demo_web",
      replicas: 2,
      actor
    });

    expect(nodePlan).toMatchObject({
      status: "ok",
      operation: {
        kind: "swarm_node_availability_plan",
        dryRun: true,
        permissionScope: "server:write"
      }
    });
    expect(scalePlan).toMatchObject({
      status: "ok",
      operation: {
        kind: "swarm_service_scale_plan",
        dryRun: true,
        permissionScope: "server:write"
      }
    });

    const operations = await db
      .select()
      .from(serverOperations)
      .where(eq(serverOperations.serverId, "srv_foundation_1"));
    expect(operations.map((operation) => operation.kind)).toEqual([
      "swarm_node_availability_plan",
      "swarm_service_scale_plan"
    ]);
  });

  it("refuses to drain the last known active manager", async () => {
    await db
      .update(servers)
      .set({
        kind: "docker-swarm-manager",
        metadata: {
          swarmTopology: {
            clusterId: "swarm-foundation",
            clusterName: "foundation",
            source: "discovered",
            defaultNamespace: null,
            nodes: [
              {
                id: "manager-a",
                name: "manager-a",
                host: "10.0.0.10",
                role: "manager",
                availability: "active",
                reachability: "reachable",
                managerStatus: "leader"
              }
            ]
          }
        }
      })
      .where(eq(servers.id, "srv_foundation_1"));

    const result = await planNodeAvailability({
      serverId: "srv_foundation_1",
      teamId,
      node: "manager-a",
      availability: "drain",
      actor
    });

    expect(result).toEqual({
      status: "unsafe",
      message: "Refusing to pause or drain the last known active Swarm manager."
    });
  });

  it("refuses live updates that would drain the last known active manager", async () => {
    await db
      .update(servers)
      .set({
        kind: "docker-swarm-manager",
        metadata: {
          swarmTopology: {
            clusterId: "swarm-foundation",
            clusterName: "foundation",
            source: "discovered",
            defaultNamespace: null,
            nodes: [
              {
                id: "manager-a",
                name: "manager-a",
                host: "10.0.0.10",
                role: "manager",
                availability: "active",
                reachability: "reachable",
                managerStatus: "leader"
              }
            ]
          }
        }
      })
      .where(eq(servers.id, "srv_foundation_1"));

    const result = await updateNodeAvailability({
      serverId: "srv_foundation_1",
      teamId,
      node: "manager-a",
      availability: "pause",
      actor
    });

    expect(result).toEqual({
      status: "unsafe",
      message: "Refusing to pause or drain the last known active Swarm manager."
    });
  });
});
