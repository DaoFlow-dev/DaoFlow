import { readServerSwarmTopology, writeServerSwarmTopology } from "./server-topology";
import {
  readServer,
  runServerOperation,
  type ServerOperationActor
} from "./server-operation-runtime";
import { resolveExecutionTarget, withPreparedExecutionTarget } from "../../worker/execution-target";
import {
  discoverSwarmTopology,
  type SwarmCommandPlan,
  type SwarmCommandRun,
  planSwarmNodeAvailability,
  planSwarmServiceScale,
  updateSwarmNodeAvailability,
  updateSwarmServiceScale
} from "../../worker/swarm-management";

type SwarmNodeAvailability = "active" | "pause" | "drain";
type SwarmTopologyRefreshResult = {
  topology: NonNullable<Awaited<ReturnType<typeof writeServerSwarmTopology>>>;
};

async function ensureSwarmServer(serverId: string, teamId: string) {
  const server = await readServer(serverId);
  if (!server || server.teamId !== teamId) return { status: "not_found" as const };
  if (server.kind !== "docker-swarm-manager") {
    return { status: "unsupported" as const, message: "Server is not a Docker Swarm manager." };
  }
  return { status: "ok" as const, server };
}

async function ensureSafeNodeAvailability(input: {
  serverId: string;
  teamId: string;
  node: string;
  availability: SwarmNodeAvailability;
}) {
  if (input.availability === "active") return { status: "ok" as const };

  const server = await readServer(input.serverId);
  if (!server || server.teamId !== input.teamId) return { status: "not_found" as const };

  const topology = readServerSwarmTopology(server);
  const node = topology?.nodes.find((candidate) => {
    return candidate.id === input.node || candidate.name === input.node;
  });
  if (!node || node.role !== "manager") return { status: "ok" as const };

  const activeManagers =
    topology?.nodes.filter((candidate) => {
      return (
        candidate.role === "manager" &&
        candidate.availability === "active" &&
        candidate.reachability !== "unreachable"
      );
    }) ?? [];

  if (activeManagers.length <= 1) {
    return {
      status: "unsafe" as const,
      message: "Refusing to pause or drain the last known active Swarm manager."
    };
  }

  return { status: "ok" as const };
}

export async function refreshSwarmTopology(input: {
  serverId: string;
  teamId: string;
  actor: ServerOperationActor;
}) {
  const resolved = await ensureSwarmServer(input.serverId, input.teamId);
  if (resolved.status !== "ok") return resolved;

  return runServerOperation({
    serverId: input.serverId,
    teamId: input.teamId,
    kind: "swarm_topology_refresh",
    dryRun: false,
    actor: input.actor,
    permissionScope: "server:write",
    startSummary: "Refreshing Docker Swarm topology from manager.",
    action: "server.swarm.topology.refresh",
    successSummary: (result: SwarmTopologyRefreshResult) =>
      `Refreshed Swarm topology with ${result.topology.summary.nodeCount} nodes.`,
    execute: async (server) => {
      const current = readServerSwarmTopology(server);
      const target = await resolveExecutionTarget(server, `swarm_${Date.now()}`, input.teamId);
      const topology = await withPreparedExecutionTarget(target, (preparedTarget) =>
        discoverSwarmTopology(
          preparedTarget,
          {
            clusterId: current?.clusterId ?? `swarm-${server.id}`,
            clusterName: current?.clusterName ?? server.name,
            defaultNamespace: current?.defaultNamespace ?? null
          },
          () => undefined
        )
      );
      const snapshot = await writeServerSwarmTopology(server.id, topology);
      if (!snapshot) throw new Error("Unable to persist Swarm topology.");
      return { topology: snapshot };
    }
  });
}

export async function planNodeAvailability(input: {
  serverId: string;
  teamId: string;
  node: string;
  availability: SwarmNodeAvailability;
  actor: ServerOperationActor;
}) {
  const resolved = await ensureSwarmServer(input.serverId, input.teamId);
  if (resolved.status !== "ok") return resolved;
  const safety = await ensureSafeNodeAvailability(input);
  if (safety.status !== "ok") return safety;

  return runServerOperation({
    serverId: input.serverId,
    kind: "swarm_node_availability_plan",
    dryRun: true,
    actor: input.actor,
    permissionScope: "server:write",
    startSummary: `Planning Swarm node ${input.node} availability change.`,
    action: "server.swarm.node.plan",
    successSummary: (result: SwarmCommandPlan) => result.summary,
    execute: () => Promise.resolve(planSwarmNodeAvailability(input))
  });
}

export async function updateNodeAvailability(input: {
  serverId: string;
  teamId: string;
  node: string;
  availability: SwarmNodeAvailability;
  actor: ServerOperationActor;
}) {
  const resolved = await ensureSwarmServer(input.serverId, input.teamId);
  if (resolved.status !== "ok") return resolved;
  const safety = await ensureSafeNodeAvailability(input);
  if (safety.status !== "ok") return safety;

  return runServerOperation({
    serverId: input.serverId,
    teamId: input.teamId,
    kind: "swarm_node_availability_update",
    dryRun: false,
    actor: input.actor,
    permissionScope: "server:write",
    startSummary: `Updating Swarm node ${input.node} availability to ${input.availability}.`,
    action: "server.swarm.node.update",
    successSummary: (result: SwarmCommandRun) => result.summary,
    execute: async (server) => {
      const target = await resolveExecutionTarget(server, `swarm_${Date.now()}`, input.teamId);
      return withPreparedExecutionTarget(target, (preparedTarget) =>
        updateSwarmNodeAvailability(preparedTarget, input, () => undefined)
      );
    }
  });
}

export async function planServiceScale(input: {
  serverId: string;
  teamId: string;
  service: string;
  replicas: number;
  actor: ServerOperationActor;
}) {
  const resolved = await ensureSwarmServer(input.serverId, input.teamId);
  if (resolved.status !== "ok") return resolved;

  return runServerOperation({
    serverId: input.serverId,
    teamId: input.teamId,
    kind: "swarm_service_scale_plan",
    dryRun: true,
    actor: input.actor,
    permissionScope: "server:write",
    startSummary: `Planning Swarm service ${input.service} scale change.`,
    action: "server.swarm.service.plan",
    successSummary: (result: SwarmCommandPlan) => result.summary,
    execute: () => Promise.resolve(planSwarmServiceScale(input))
  });
}

export async function updateServiceScale(input: {
  serverId: string;
  teamId: string;
  service: string;
  replicas: number;
  actor: ServerOperationActor;
}) {
  const resolved = await ensureSwarmServer(input.serverId, input.teamId);
  if (resolved.status !== "ok") return resolved;

  return runServerOperation({
    serverId: input.serverId,
    teamId: input.teamId,
    kind: "swarm_service_scale_update",
    dryRun: false,
    actor: input.actor,
    permissionScope: "server:write",
    startSummary: `Scaling Swarm service ${input.service} to ${input.replicas} replicas.`,
    action: "server.swarm.service.scale",
    successSummary: (result: SwarmCommandRun) => result.summary,
    execute: async (server) => {
      const target = await resolveExecutionTarget(server, `swarm_${Date.now()}`, input.teamId);
      return withPreparedExecutionTarget(target, (preparedTarget) =>
        updateSwarmServiceScale(preparedTarget, input, () => undefined)
      );
    }
  });
}
