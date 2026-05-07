import {
  swarmTopologySchema,
  type SwarmTopology,
  type SwarmTopologySnapshot
} from "@daoflow/shared";
import { eq } from "drizzle-orm";
import { db } from "../connection";
import { servers } from "../schema/servers";
import { asRecord } from "./json-helpers";

const SWARM_TOPOLOGY_KEY = "swarmTopology";

interface ServerTopologyRecord {
  id: string;
  name: string;
  host: string;
  kind: string;
  metadata: unknown;
}

function createDefaultSwarmTopology(server: ServerTopologyRecord): SwarmTopology {
  return {
    clusterId: `swarm-${server.id}`,
    clusterName: server.name,
    source: "registration",
    defaultNamespace: null,
    nodes: [
      {
        id: `${server.id}-manager`,
        name: server.name,
        host: server.host,
        role: "manager",
        availability: "active",
        reachability: "unknown",
        managerStatus: "leader"
      }
    ]
  };
}

function summarizeSwarmTopology(topology: SwarmTopology): SwarmTopologySnapshot["summary"] {
  const managerCount = topology.nodes.filter((node) => node.role === "manager").length;
  const workerCount = topology.nodes.length - managerCount;

  return {
    nodeCount: topology.nodes.length,
    managerCount,
    workerCount,
    activeNodeCount: topology.nodes.filter((node) => node.availability === "active").length,
    reachableNodeCount: topology.nodes.filter((node) => node.reachability === "reachable").length
  };
}

function parseOrDefaultSwarmTopology(server: ServerTopologyRecord): SwarmTopology {
  const metadata = asRecord(server.metadata);
  const parsed = swarmTopologySchema.safeParse(metadata[SWARM_TOPOLOGY_KEY]);

  if (parsed.success) {
    return parsed.data;
  }

  return createDefaultSwarmTopology(server);
}

export function withRegisteredServerTopologyMetadata(
  server: Pick<ServerTopologyRecord, "id" | "name" | "host" | "kind">,
  metadata: unknown
) {
  const nextMetadata = { ...asRecord(metadata) };

  if (server.kind !== "docker-swarm-manager") {
    return nextMetadata;
  }

  nextMetadata[SWARM_TOPOLOGY_KEY] = parseOrDefaultSwarmTopology({
    ...server,
    metadata: nextMetadata
  });

  return nextMetadata;
}

export function readServerSwarmTopology(
  server: Pick<ServerTopologyRecord, "id" | "name" | "host" | "kind" | "metadata">
): SwarmTopologySnapshot | null {
  if (server.kind !== "docker-swarm-manager") {
    return null;
  }

  const topology = parseOrDefaultSwarmTopology(server);
  return {
    ...topology,
    summary: summarizeSwarmTopology(topology)
  };
}

export async function writeServerSwarmTopology(serverId: string, topology: SwarmTopology) {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return null;

  const parsed = swarmTopologySchema.parse(topology);
  const metadata = {
    ...asRecord(server.metadata),
    [SWARM_TOPOLOGY_KEY]: parsed
  };

  const [updated] = await db
    .update(servers)
    .set({ metadata, updatedAt: new Date() })
    .where(eq(servers.id, serverId))
    .returning();

  return readServerSwarmTopology(updated);
}
