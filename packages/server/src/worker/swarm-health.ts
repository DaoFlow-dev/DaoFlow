export interface SwarmServiceStatus {
  id: string;
  name: string;
  mode: string;
  replicas: string;
  image: string;
  ports: string | null;
}

export interface SwarmTaskStatus {
  id: string;
  name: string;
  image: string;
  node: string | null;
  desiredState: string;
  currentState: string;
  error: string | null;
  ports: string | null;
}

export type SwarmHealthAssessment =
  | {
      kind: "healthy";
      summary: string;
    }
  | {
      kind: "pending";
      summary: string;
    }
  | {
      kind: "failed";
      summary: string;
    };

type SwarmJsonRecord = Record<string, unknown>;

function readString(record: SwarmJsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readOptionalString(record: SwarmJsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseDockerJsonLines<T>(output: string, normalize: (record: SwarmJsonRecord) => T): T[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Docker JSON output was not an array");
    }

    return parsed
      .filter((entry): entry is SwarmJsonRecord => Boolean(entry) && typeof entry === "object")
      .map(normalize);
  }

  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => normalize(JSON.parse(line) as SwarmJsonRecord));
}

function normalizeSwarmServiceStatus(record: SwarmJsonRecord): SwarmServiceStatus {
  return {
    id: readString(record, "ID"),
    name: readString(record, "Name"),
    mode: readString(record, "Mode"),
    replicas: readString(record, "Replicas"),
    image: readString(record, "Image"),
    ports: readOptionalString(record, "Ports")
  };
}

function normalizeSwarmTaskStatus(record: SwarmJsonRecord): SwarmTaskStatus {
  return {
    id: readString(record, "ID"),
    name: readString(record, "Name"),
    image: readString(record, "Image"),
    node: readOptionalString(record, "Node"),
    desiredState: readString(record, "DesiredState"),
    currentState: readString(record, "CurrentState"),
    error: readOptionalString(record, "Error"),
    ports: readOptionalString(record, "Ports")
  };
}

function parseReplicaCounts(replicas: string): { running: number; desired: number } | null {
  const match = replicas.trim().match(/^(\d+)\/(\d+)/);
  if (!match) {
    return null;
  }

  return {
    running: Number(match[1]),
    desired: Number(match[2])
  };
}

function taskPhase(task: SwarmTaskStatus): string {
  return task.currentState.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

export function parseSwarmServiceLsOutput(output: string): SwarmServiceStatus[] {
  return parseDockerJsonLines(output, normalizeSwarmServiceStatus);
}

export function parseSwarmTaskPsOutput(output: string): SwarmTaskStatus[] {
  return parseDockerJsonLines(output, normalizeSwarmTaskStatus);
}

export function assessSwarmStackHealth(
  services: SwarmServiceStatus[],
  tasks: SwarmTaskStatus[],
  targetLabel: string
): SwarmHealthAssessment {
  if (services.length === 0) {
    return {
      kind: "pending",
      summary: `${targetLabel} has not reported any services yet`
    };
  }

  const failures: string[] = [];
  const pending: string[] = [];

  for (const service of services) {
    const replicaCounts = parseReplicaCounts(service.replicas);
    if (!replicaCounts) {
      pending.push(
        `${service.name || "service"} replica state is ${service.replicas || "unknown"}`
      );
      continue;
    }

    if (replicaCounts.running < replicaCounts.desired) {
      pending.push(`${service.name || "service"} is at ${service.replicas} replicas`);
      continue;
    }

    if (replicaCounts.running > replicaCounts.desired) {
      pending.push(`${service.name || "service"} is reconciling at ${service.replicas} replicas`);
    }
  }

  if (tasks.length === 0) {
    pending.push("running tasks have not reported yet");
  }

  for (const task of tasks) {
    const phase = taskPhase(task);
    const label = task.name || "task";

    if (phase === "running") {
      continue;
    }

    if (
      phase === "new" ||
      phase === "pending" ||
      phase === "allocated" ||
      phase === "assigned" ||
      phase === "accepted" ||
      phase === "preparing" ||
      phase === "ready" ||
      phase === "starting"
    ) {
      pending.push(`${label} is ${task.currentState}`);
      continue;
    }

    const errorDetail = task.error ? `: ${task.error}` : "";
    failures.push(`${label} is ${task.currentState}${errorDetail}`);
  }

  if (failures.length > 0) {
    return {
      kind: "failed",
      summary: `${targetLabel} failed health checks: ${failures.join("; ")}`
    };
  }

  if (pending.length > 0) {
    return {
      kind: "pending",
      summary: `${targetLabel} is still converging: ${pending.join("; ")}`
    };
  }

  return {
    kind: "healthy",
    summary: `${targetLabel} reached the desired replica state`
  };
}
