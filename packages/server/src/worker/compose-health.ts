export interface ComposeContainerStatus {
  service: string;
  name: string;
  state: string;
  status: string;
  health: string | null;
  exitCode: number | null;
}

export type ComposeHealthAssessment =
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

type ComposePsRecord = Record<string, unknown>;

function readString(record: ComposePsRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readOptionalString(record: ComposePsRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionalNumber(record: ComposePsRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function normalizeComposePsRecord(record: ComposePsRecord): ComposeContainerStatus {
  return {
    service: readString(record, "Service"),
    name: readString(record, "Name") || readString(record, "Names"),
    state: readString(record, "State"),
    status: readString(record, "Status"),
    health: readOptionalString(record, "Health"),
    exitCode: readOptionalNumber(record, "ExitCode")
  };
}

export function parseComposePsOutput(output: string): ComposeContainerStatus[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("docker compose ps JSON output was not an array");
    }

    return parsed
      .filter((entry): entry is ComposePsRecord => Boolean(entry) && typeof entry === "object")
      .map(normalizeComposePsRecord);
  }

  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => normalizeComposePsRecord(JSON.parse(line) as ComposePsRecord));
}

function formatContainerLabel(container: ComposeContainerStatus): string {
  return container.service && container.name
    ? `${container.service} (${container.name})`
    : container.service || container.name || "container";
}

export function assessComposeHealth(
  statuses: ComposeContainerStatus[],
  targetLabel: string
): ComposeHealthAssessment {
  if (statuses.length === 0) {
    return {
      kind: "pending",
      summary: `${targetLabel} have not reported any running containers yet`
    };
  }

  const failures: string[] = [];
  const pending: string[] = [];
  const completedSuccessfully: string[] = [];
  let allHaveDockerHealthchecks = true;
  let hasRunningContainer = false;

  for (const status of statuses) {
    const label = formatContainerLabel(status);
    const state = status.state.trim().toLowerCase();
    const health = status.health?.trim().toLowerCase() ?? null;

    if (!health) {
      allHaveDockerHealthchecks = false;
    }

    if (health === "unhealthy") {
      failures.push(`${label} is unhealthy (${status.status || state || "unknown"})`);
      continue;
    }

    if (state === "exited" && status.exitCode === 0) {
      completedSuccessfully.push(label);
      continue;
    }

    if (state === "exited" || state === "dead" || state === "removing" || state === "paused") {
      const exitSuffix =
        typeof status.exitCode === "number" ? `, exit code ${status.exitCode}` : "";
      failures.push(`${label} is ${state}${exitSuffix}`);
      continue;
    }

    if (state !== "running") {
      pending.push(`${label} is ${state || "not ready"}`);
      continue;
    }

    hasRunningContainer = true;

    if (health && health !== "healthy") {
      pending.push(`${label} health is ${health}`);
    }
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
      summary: `${targetLabel} are still converging: ${pending.join("; ")}`
    };
  }

  if (!hasRunningContainer) {
    if (completedSuccessfully.length > 0 && completedSuccessfully.length === statuses.length) {
      return {
        kind: "healthy",
        summary: `${targetLabel} completed successfully`
      };
    }

    const completedSummary =
      completedSuccessfully.length > 0
        ? `: ${completedSuccessfully.join("; ")} completed successfully`
        : "";
    return {
      kind: "pending",
      summary: `${targetLabel} have no running containers yet${completedSummary}`
    };
  }

  return {
    kind: "healthy",
    summary: allHaveDockerHealthchecks ? `${targetLabel} are healthy` : `${targetLabel} are running`
  };
}
