import { dockerCommand } from "./command-env";
import { execStreaming } from "./docker-exec-shared";
import type { ResolvedServiceRuntime } from "../db/services/service-runtime";
import type { ServiceRuntimeLogging } from "../service-runtime-config";
import type { ExecutionTarget } from "./execution-target";
import { withPreparedExecutionTarget } from "./execution-target";
import { parseDockerPsLines } from "./service-observability-parsers";
import { execRemote, shellQuote } from "./ssh-executor";

export type ServiceLoggingInspectionStatus =
  "aligned" | "drifted" | "mixed" | "not-managed" | "unavailable" | "unsupported";

export interface ServiceLoggingContainerState {
  name: string;
  driver: string | null;
  maxSize: string | null;
  maxFiles: string | null;
  matchesDesired: boolean | null;
}

export interface ServiceLoggingInspection {
  status: ServiceLoggingInspectionStatus;
  reason: string | null;
  containers: ServiceLoggingContainerState[];
}

interface DockerCommandResult {
  exitCode: number;
  stdout: string[];
}

type DockerCommandRunner = (
  target: ExecutionTarget,
  args: string[]
) => Promise<DockerCommandResult>;

function buildDockerCommand(args: string[]): string {
  return ["docker", ...args].map((part) => shellQuote(part)).join(" ");
}

async function runDockerCommand(
  target: ExecutionTarget,
  args: string[]
): Promise<DockerCommandResult> {
  const stdout: string[] = [];

  if (target.mode === "local") {
    const result = await execStreaming(dockerCommand, args, process.cwd(), (line) => {
      if (line.stream === "stdout") {
        stdout.push(line.message);
      }
    });
    return { exitCode: result.exitCode, stdout };
  }

  const result = await execRemote(target.ssh, buildDockerCommand(args), (line) => {
    if (line.stream === "stdout") {
      stdout.push(line.message);
    }
  });
  return { exitCode: result.exitCode, stdout };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseDockerLoggingInspectLines(lines: string[]): Array<{
  name: string;
  driver: string | null;
  maxSize: string | null;
  maxFiles: string | null;
}> {
  return lines.flatMap((line) => {
    const separator = line.indexOf("\t");
    if (separator < 1) {
      return [];
    }

    const name = line.slice(0, separator).trim().replace(/^\/+/, "");
    if (!name) {
      return [];
    }

    try {
      const logConfig = readRecord(JSON.parse(line.slice(separator + 1)));
      if (!logConfig) {
        return [];
      }
      const options = readRecord(logConfig.Config);
      return [
        {
          name,
          driver: readString(logConfig.Type),
          maxSize: readString(options?.["max-size"]),
          maxFiles: readString(options?.["max-file"])
        }
      ];
    } catch {
      return [];
    }
  });
}

function matchesDesired(
  actual: Omit<ServiceLoggingContainerState, "matchesDesired">,
  desired: ServiceRuntimeLogging | null
): boolean | null {
  if (!desired) {
    return null;
  }

  return (
    actual.driver === desired.driver &&
    actual.maxSize === `${desired.maxSizeMb}m` &&
    actual.maxFiles === String(desired.maxFiles)
  );
}

async function resolveContainerNames(
  runtime: ResolvedServiceRuntime,
  runner: DockerCommandRunner
): Promise<string[] | null> {
  if (runtime.kind === "container") {
    return [runtime.containerName];
  }

  const result = await runner(runtime.target, [
    "ps",
    "-a",
    "--format",
    "json",
    "--filter",
    `label=com.docker.compose.project=${runtime.projectName}`,
    "--filter",
    `label=com.docker.compose.service=${runtime.composeServiceName}`
  ]);
  if (result.exitCode !== 0) {
    return null;
  }

  return parseDockerPsLines(result.stdout)
    .map((container) => container.name)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function resolveStatus(
  containers: ServiceLoggingContainerState[],
  desired: ServiceRuntimeLogging | null
): ServiceLoggingInspectionStatus {
  if (containers.length === 0) {
    return "unavailable";
  }
  if (!desired) {
    return "not-managed";
  }

  const matchingContainers = containers.filter((container) => container.matchesDesired).length;
  if (matchingContainers === containers.length) {
    return "aligned";
  }
  return matchingContainers === 0 ? "drifted" : "mixed";
}

export async function inspectServiceLogging(input: {
  runtime: ResolvedServiceRuntime;
  desired: ServiceRuntimeLogging | null;
  runDockerCommand?: DockerCommandRunner;
}): Promise<ServiceLoggingInspection> {
  if (input.runtime.target.serverKind === "docker-swarm-manager") {
    return {
      status: "unsupported",
      reason: "Docker Swarm logging inspection is not supported yet.",
      containers: []
    };
  }

  const runner = input.runDockerCommand ?? runDockerCommand;
  try {
    return await withPreparedExecutionTarget(input.runtime.target, async (target) => {
      const runtime = { ...input.runtime, target };
      const containerNames = await resolveContainerNames(runtime, runner);
      if (!containerNames?.length) {
        return {
          status: "unavailable",
          reason: "No containers were found for this service.",
          containers: []
        };
      }

      const result = await runner(runtime.target, [
        "inspect",
        "--format",
        "{{.Name}}\t{{json .HostConfig.LogConfig}}",
        ...containerNames
      ]);
      if (result.exitCode !== 0) {
        return {
          status: "unavailable",
          reason: "Docker logging configuration could not be inspected.",
          containers: []
        };
      }

      const containers = parseDockerLoggingInspectLines(result.stdout).map((container) => ({
        ...container,
        matchesDesired: matchesDesired(container, input.desired)
      }));

      return {
        status: resolveStatus(containers, input.desired),
        reason: null,
        containers
      };
    });
  } catch {
    return {
      status: "unavailable",
      reason: "Docker logging configuration could not be inspected.",
      containers: []
    };
  }
}
