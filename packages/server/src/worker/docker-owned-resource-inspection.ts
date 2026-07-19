import type { OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { DOCKER_OWNERSHIP_LABEL_KEYS } from "../docker-ownership";
import {
  buildDockerOwnershipLabelInspectFormat,
  parseDockerOwnershipLabelFields
} from "./docker-ownership-inspect";
import {
  executeDockerTargetCommand,
  type DockerCommandResult,
  type DockerTargetExecutor
} from "./runtime-cleanup";

const MANAGED_LABEL_FILTER = "label=io.daoflow.managed=true";
const CONTAINER_LIST_FORMAT = "{{json .ID}}\t{{json .Names}}";
const NAME_LIST_FORMAT = "{{json .ID}}\t{{json .Name}}";
const IMAGE_LIST_FORMAT = '{{json .ID}}\t{{json (printf "%s:%s" .Repository .Tag)}}';
const VOLUME_LIST_FORMAT = "{{json .Name}}\t{{json .Name}}";

function inspectFormat(id: string, name: string, labels: string): string {
  return [
    `{{json ${id}}}`,
    `{{json ${name}}}`,
    buildDockerOwnershipLabelInspectFormat(labels)
  ].join("\t");
}

export type DockerOwnedResourceType = "container" | "image" | "network" | "volume" | "service";
type DockerOwnedResourceCollection = keyof Pick<
  DockerOwnedResourceSnapshot,
  "containers" | "images" | "networks" | "volumes" | "services"
>;

export interface DockerOwnedResource {
  id: string;
  name: string;
  labels: Record<string, string>;
}

// prettier-ignore
export type DockerOwnedResourceIssueCode = "command-failed" | "execution-failed" | "malformed-list-entry" | "malformed-inspect-entry" | "not-managed" | "missing-inspection";

export interface DockerOwnedResourceInspectionIssue {
  resourceType: DockerOwnedResourceType;
  code: DockerOwnedResourceIssueCode;
  line?: number;
  exitCode?: number;
}

export interface DockerOwnedResourceSnapshot {
  checkedAt: string;
  containers: DockerOwnedResource[];
  images: DockerOwnedResource[];
  networks: DockerOwnedResource[];
  volumes: DockerOwnedResource[];
  services: DockerOwnedResource[];
  issues: DockerOwnedResourceInspectionIssue[];
}

type ListedResource = { id: string; name: string };
type InspectedResource = DockerOwnedResource & { references?: string[] };

interface ResourceSpec {
  type: DockerOwnedResourceType;
  collection: DockerOwnedResourceCollection;
  listArgs: string[];
  inspectArgs: (ids: string[]) => string[];
}

const RESOURCE_SPECS: ResourceSpec[] = [
  // prettier-ignore
  { type: "container", collection: "containers", listArgs: ["ps", "--all", "--filter", MANAGED_LABEL_FILTER, "--format", CONTAINER_LIST_FORMAT], inspectArgs: (ids) => ["inspect", "--type", "container", "--format", inspectFormat(".Id", ".Name", ".Config.Labels"), ...ids] },
  // prettier-ignore
  { type: "image", collection: "images", listArgs: ["image", "ls", "--all", "--filter", MANAGED_LABEL_FILTER, "--format", IMAGE_LIST_FORMAT], inspectArgs: (ids) => ["image", "inspect", "--format", inspectFormat(".Id", ".RepoTags", ".Config.Labels"), ...ids] },
  // prettier-ignore
  { type: "network", collection: "networks", listArgs: ["network", "ls", "--filter", MANAGED_LABEL_FILTER, "--format", NAME_LIST_FORMAT], inspectArgs: (ids) => ["network", "inspect", "--format", inspectFormat(".Id", ".Name", ".Labels"), ...ids] },
  // prettier-ignore
  { type: "volume", collection: "volumes", listArgs: ["volume", "ls", "--filter", MANAGED_LABEL_FILTER, "--format", VOLUME_LIST_FORMAT], inspectArgs: (ids) => ["volume", "inspect", "--format", inspectFormat(".Name", ".Name", ".Labels"), ...ids] },
  // prettier-ignore
  { type: "service", collection: "services", listArgs: ["service", "ls", "--filter", MANAGED_LABEL_FILTER, "--format", NAME_LIST_FORMAT], inspectArgs: (ids) => ["service", "inspect", "--format", inspectFormat(".ID", ".Spec.Name", ".Spec.Labels"), ...ids] }
];
const emptySnapshot = (): DockerOwnedResourceSnapshot => ({
  checkedAt: new Date().toISOString(),
  containers: [],
  images: [],
  networks: [],
  volumes: [],
  services: [],
  issues: []
});
function parseStringField(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    return null;
  }
}

function parseListLines(
  type: DockerOwnedResourceType,
  lines: string[],
  issues: DockerOwnedResourceInspectionIssue[]
): ListedResource[] {
  const entries: ListedResource[] = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    const fields = line.split("\t");
    const id = fields.length === 2 ? parseStringField(fields[0] ?? "") : null;
    const name = fields.length === 2 ? parseStringField(fields[1] ?? "") : null;
    if (!id || !name) {
      issues.push({ resourceType: type, code: "malformed-list-entry", line: index + 1 });
      return;
    }

    entries.push({ id, name });
  });

  return entries;
}

function parseNameField(value: string, type: DockerOwnedResourceType): string | string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (type === "image") {
      if (parsed === null) return [];
      if (Array.isArray(parsed)) {
        const references = parsed.filter(
          (reference): reference is string => typeof reference === "string"
        );
        return references.length === parsed.length ? references : null;
      }
      return typeof parsed === "string" ? (parsed.trim() ? [parsed.trim()] : []) : null;
    }
    return typeof parsed === "string" ? parsed.trim() : null;
  } catch {
    return null;
  }
}

function parseInspectLines(
  type: DockerOwnedResourceType,
  lines: string[],
  issues: DockerOwnedResourceInspectionIssue[]
): InspectedResource[] {
  const entries: InspectedResource[] = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    const fields = line.split("\t");
    if (fields.length !== 2 + DOCKER_OWNERSHIP_LABEL_KEYS.length) {
      issues.push({ resourceType: type, code: "malformed-inspect-entry", line: index + 1 });
      return;
    }

    const id = parseStringField(fields[0] ?? "");
    const parsedName = parseNameField(fields[1] ?? "", type);
    const labels = parseDockerOwnershipLabelFields(fields.slice(2));
    if (!id || parsedName === null || labels === null) {
      issues.push({ resourceType: type, code: "malformed-inspect-entry", line: index + 1 });
      return;
    }

    if (labels["io.daoflow.managed"] !== "true") {
      issues.push({ resourceType: type, code: "not-managed", line: index + 1 });
      return;
    }

    if (type === "image") {
      const references = Array.isArray(parsedName) ? parsedName : [parsedName];
      entries.push({ id, name: "", labels, references });
    } else {
      entries.push({
        id,
        name: typeof parsedName === "string" ? parsedName.replace(/^\/+/, "") : "",
        labels
      });
    }
  });

  return entries;
}

function idMatches(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function sortResources(resources: DockerOwnedResource[]): DockerOwnedResource[] {
  return resources.sort(
    (left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name)
  );
}

function sortIssues(issues: DockerOwnedResourceInspectionIssue[]): void {
  issues.sort(
    (left, right) =>
      left.resourceType.localeCompare(right.resourceType) ||
      left.code.localeCompare(right.code) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.exitCode ?? 0) - (right.exitCode ?? 0)
  );
}

async function collectResource(
  target: ExecutionTarget,
  spec: ResourceSpec,
  onLog: OnLog,
  execute: DockerTargetExecutor,
  issues: DockerOwnedResourceInspectionIssue[]
): Promise<DockerOwnedResource[]> {
  let listResult: DockerCommandResult;
  try {
    listResult = await execute(target, spec.listArgs, onLog);
  } catch {
    issues.push({ resourceType: spec.type, code: "execution-failed" });
    return [];
  }

  if (listResult.exitCode !== 0) {
    issues.push({ resourceType: spec.type, code: "command-failed", exitCode: listResult.exitCode });
    return [];
  }

  const listed = parseListLines(spec.type, listResult.stdout, issues);
  const ids = [...new Set(listed.map((entry) => entry.id))];
  if (ids.length === 0) return [];

  let inspectResult: DockerCommandResult;
  try {
    inspectResult = await execute(target, spec.inspectArgs(ids), onLog);
  } catch {
    issues.push({ resourceType: spec.type, code: "execution-failed" });
    return [];
  }

  const inspected = parseInspectLines(spec.type, inspectResult.stdout, issues);
  const resources = inspected.flatMap((entry) => {
    const listedEntry = listed.find((candidate) => idMatches(candidate.id, entry.id));
    if (!listedEntry) return [];

    const imageReference = entry.references?.filter(Boolean).sort()[0];
    const name = imageReference ?? (entry.name || listedEntry.name);
    if (!name) return [];

    return [{ id: entry.id, name, labels: entry.labels }];
  });

  for (const listedEntry of listed) {
    if (!inspected.some((entry) => idMatches(listedEntry.id, entry.id))) {
      issues.push({ resourceType: spec.type, code: "missing-inspection" });
    }
  }

  if (inspectResult.exitCode !== 0 && resources.length === 0) {
    issues.push({
      resourceType: spec.type,
      code: "command-failed",
      exitCode: inspectResult.exitCode
    });
  }

  return sortResources(resources);
}

export async function inspectDockerOwnedResources(
  target: ExecutionTarget,
  onLog: OnLog = () => {},
  execute: DockerTargetExecutor = executeDockerTargetCommand
): Promise<DockerOwnedResourceSnapshot> {
  const snapshot = emptySnapshot();
  const specs = RESOURCE_SPECS.filter(
    (spec) => spec.type !== "service" || target.serverKind === "docker-swarm-manager"
  );

  for (const spec of specs) {
    snapshot[spec.collection] = await collectResource(
      target,
      spec,
      onLog,
      execute,
      snapshot.issues
    );
  }

  sortIssues(snapshot.issues);
  return snapshot;
}
