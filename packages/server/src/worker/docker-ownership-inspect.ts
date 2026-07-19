import { DOCKER_OWNERSHIP_LABEL_KEYS } from "../docker-ownership";

export function buildDockerOwnershipLabelInspectFormat(labelsExpression: string): string {
  return DOCKER_OWNERSHIP_LABEL_KEYS.map(
    (key) => `{{json (index ${labelsExpression} "${key}")}}`
  ).join("\t");
}

export function parseDockerOwnershipLabelFields(values: string[]): Record<string, string> | null {
  if (values.length !== DOCKER_OWNERSHIP_LABEL_KEYS.length) return null;
  const labels: Record<string, string> = {};
  for (const [index, key] of DOCKER_OWNERSHIP_LABEL_KEYS.entries()) {
    try {
      const parsed: unknown = JSON.parse(values[index] ?? "null");
      if (parsed === null) continue;
      if (typeof parsed !== "string") return null;
      labels[key] = parsed;
    } catch {
      return null;
    }
  }
  return labels;
}

export function parseDockerOwnershipLabelLine(line: string): Record<string, string> | null {
  return parseDockerOwnershipLabelFields(line.trim().split("\t"));
}
