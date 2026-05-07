import type { SwarmTopology, SwarmTopologyNode } from "@daoflow/shared";
import { dockerCommand } from "./command-env";
import { execStreaming, STAGING_DIR, type OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { execRemote, shellQuote } from "./ssh-connection";

type DockerJsonRecord = Record<string, unknown>;

export interface SwarmCommandPlan {
  dryRun: true;
  command: string;
  summary: string;
}

export interface SwarmCommandRun {
  dryRun: false;
  command: string;
  exitCode: number;
  summary: string;
}

function readString(record: DockerJsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

export function parseDockerJsonLines(output: string): DockerJsonRecord[] {
  return output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DockerJsonRecord);
}

function normalizeAvailability(value: string): SwarmTopologyNode["availability"] {
  const normalized = value.toLowerCase();
  return normalized === "active" || normalized === "pause" || normalized === "drain"
    ? normalized
    : "unknown";
}

function normalizeReachability(value: string): SwarmTopologyNode["reachability"] {
  const normalized = value.toLowerCase();
  if (normalized === "ready") return "reachable";
  if (normalized === "down" || normalized === "unknown") return "unreachable";
  return "unknown";
}

function normalizeManagerStatus(value: string): SwarmTopologyNode["managerStatus"] {
  const normalized = value.toLowerCase();
  if (normalized === "leader") return "leader";
  if (normalized === "reachable") return "reachable";
  if (normalized === "unreachable") return "unreachable";
  return normalized.length > 0 ? "unknown" : "none";
}

export function nodeFromDocker(record: DockerJsonRecord): SwarmTopologyNode {
  const managerStatus = normalizeManagerStatus(readString(record, "ManagerStatus"));
  return {
    id: readString(record, "ID").replace(/\*$/, ""),
    name: readString(record, "Hostname"),
    host: null,
    role: managerStatus === "none" ? "worker" : "manager",
    availability: normalizeAvailability(readString(record, "Availability")),
    reachability: normalizeReachability(readString(record, "Status")),
    managerStatus
  };
}

async function runDockerCommand(
  target: ExecutionTarget,
  args: string[],
  onLog: OnLog
): Promise<{ exitCode: number; stdout: string }> {
  const stdoutLines: string[] = [];
  const captureLog: OnLog = (line) => {
    if (line.stream === "stdout") {
      stdoutLines.push(line.message);
      return;
    }
    onLog(line);
  };

  const result =
    target.mode === "remote"
      ? await execRemote(target.ssh, args.map(shellQuote).join(" "), captureLog, {
          preview: args.join(" ")
        })
      : await execStreaming(dockerCommand, args.slice(1), STAGING_DIR, captureLog);

  return { exitCode: result.exitCode, stdout: stdoutLines.join("\n") };
}

export async function discoverSwarmTopology(
  target: ExecutionTarget,
  fallback: Pick<SwarmTopology, "clusterId" | "clusterName" | "defaultNamespace">,
  onLog: OnLog
): Promise<SwarmTopology> {
  const result = await runDockerCommand(
    target,
    ["docker", "node", "ls", "--format", "json"],
    onLog
  );
  if (result.exitCode !== 0) {
    throw new Error("Unable to list Docker Swarm nodes from the manager.");
  }

  const nodes = parseDockerJsonLines(result.stdout).map(nodeFromDocker);
  if (nodes.length === 0) {
    throw new Error("Docker Swarm node discovery returned no nodes.");
  }

  return {
    clusterId: fallback.clusterId,
    clusterName: fallback.clusterName,
    source: "discovered",
    defaultNamespace: fallback.defaultNamespace,
    nodes
  };
}

export function planSwarmNodeAvailability(input: {
  node: string;
  availability: "active" | "pause" | "drain";
}): SwarmCommandPlan {
  return {
    dryRun: true,
    command: `docker node update --availability ${input.availability} ${input.node}`,
    summary: `Would set Swarm node ${input.node} availability to ${input.availability}.`
  };
}

export async function updateSwarmNodeAvailability(
  target: ExecutionTarget,
  input: { node: string; availability: "active" | "pause" | "drain" },
  onLog: OnLog
): Promise<SwarmCommandRun> {
  const plan = planSwarmNodeAvailability(input);
  const result = await runDockerCommand(
    target,
    ["docker", "node", "update", "--availability", input.availability, input.node],
    onLog
  );
  if (result.exitCode !== 0) {
    throw new Error(`Swarm node availability update failed with exit code ${result.exitCode}.`);
  }

  return { ...plan, dryRun: false, exitCode: result.exitCode };
}

export function planSwarmServiceScale(input: {
  service: string;
  replicas: number;
}): SwarmCommandPlan {
  return {
    dryRun: true,
    command: `docker service scale ${input.service}=${input.replicas}`,
    summary: `Would scale Swarm service ${input.service} to ${input.replicas} replicas.`
  };
}

export async function updateSwarmServiceScale(
  target: ExecutionTarget,
  input: { service: string; replicas: number },
  onLog: OnLog
): Promise<SwarmCommandRun> {
  const plan = planSwarmServiceScale(input);
  const result = await runDockerCommand(
    target,
    ["docker", "service", "scale", `${input.service}=${input.replicas}`],
    onLog
  );
  if (result.exitCode !== 0) {
    throw new Error(`Swarm service scale failed with exit code ${result.exitCode}.`);
  }

  return { ...plan, dryRun: false, exitCode: result.exitCode };
}
