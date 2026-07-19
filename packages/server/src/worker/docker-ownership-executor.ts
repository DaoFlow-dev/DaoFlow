import type { DockerOwnershipLabels } from "../docker-ownership";
import { dockerCommand } from "./command-env";
import { execStreaming, type OnLog, STAGING_DIR } from "./docker-exec-shared";
import {
  buildDockerOwnershipLabelInspectFormat,
  parseDockerOwnershipLabelLine
} from "./docker-ownership-inspect";

export function dockerLabelArgs(labels: DockerOwnershipLabels): string[] {
  return Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

export function buildDockerMetadataWrapperArgs(
  sourceTag: string,
  outputTag: string,
  labels: DockerOwnershipLabels
): string[] {
  return [
    "build",
    "--build-arg",
    `BASE_IMAGE=${sourceTag}`,
    ...dockerLabelArgs(labels),
    "-t",
    outputTag,
    "-f",
    "-",
    "."
  ];
}

export async function dockerBuildMetadataWrapper(
  sourceTag: string,
  outputTag: string,
  labels: DockerOwnershipLabels,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Adding DaoFlow ownership labels to image ${outputTag}`,
    timestamp: new Date()
  });

  return execStreaming(
    dockerCommand,
    buildDockerMetadataWrapperArgs(sourceTag, outputTag, labels),
    STAGING_DIR,
    onLog,
    undefined,
    { stdin: "ARG BASE_IMAGE\nFROM ${BASE_IMAGE}", signal }
  );
}

export async function inspectDockerVolume(
  name: string,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exists: boolean; labels: Record<string, string> }> {
  const output: string[] = [];
  const result = await execStreaming(
    dockerCommand,
    ["volume", "inspect", "--format", buildDockerOwnershipLabelInspectFormat(".Labels"), name],
    STAGING_DIR,
    (line) => {
      onLog(line);
      output.push(line.message);
    },
    undefined,
    { signal }
  );
  const rawOutput = output.join("\n");
  if (result.exitCode !== 0) {
    if (/no such volume/i.test(rawOutput)) return { exists: false, labels: {} };
    throw new Error(`Unable to inspect Docker volume "${name}".`);
  }

  const labels = parseDockerOwnershipLabelLine(rawOutput);
  if (!labels) {
    throw new Error(`Docker volume "${name}" returned unreadable labels.`);
  }
  return { exists: true, labels };
}

export async function createDockerVolume(
  name: string,
  labels: DockerOwnershipLabels,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  return execStreaming(
    dockerCommand,
    ["volume", "create", ...dockerLabelArgs(labels), name],
    STAGING_DIR,
    onLog,
    undefined,
    { signal }
  );
}
