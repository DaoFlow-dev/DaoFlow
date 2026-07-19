import {
  assertDockerOwnershipIdentity,
  matchesDockerOwnership,
  readDockerOwnershipIdentity,
  type DockerOwnershipIdentity
} from "../docker-ownership";
import {
  buildDockerOwnershipLabelInspectFormat,
  parseDockerOwnershipLabelFields
} from "./docker-ownership-inspect";
import type { OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import type { DockerCommandResult, DockerTargetExecutor } from "./runtime-cleanup";

export type ComposeRuntimeKind = "compose" | "swarm";
type RuntimeOwnershipKind = ComposeRuntimeKind | "container";

export interface ComposeRuntimeOwnershipSnapshot {
  containers: string[];
  networks: string[];
  volumes: string[];
  services: string[];
  configs: string[];
  secrets: string[];
}

type RuntimeResourceCollection = keyof ComposeRuntimeOwnershipSnapshot;

interface RuntimeResourceSpec {
  resourceType: string;
  collection: RuntimeResourceCollection;
  listArgs: (runtimeName: string) => string[];
  inspectArgs: (ids: string[]) => string[];
}

const COMPOSE_PROJECT_LABEL_KEY = "com.docker.compose.project";
const SWARM_STACK_LABEL_KEY = "com.docker.stack.namespace";

function buildInspectFormat(id: string, labels: string): string {
  return [`{{json ${id}}}`, buildDockerOwnershipLabelInspectFormat(labels)].join("\t");
}

const composeResourceSpecs: RuntimeResourceSpec[] = [
  {
    resourceType: "container",
    collection: "containers",
    listArgs: (runtimeName) => [
      "ps",
      "-aq",
      "--filter",
      `label=${COMPOSE_PROJECT_LABEL_KEY}=${runtimeName}`
    ],
    inspectArgs: (ids) => [
      "inspect",
      "--type",
      "container",
      "--format",
      buildInspectFormat(".Id", ".Config.Labels"),
      ...ids
    ]
  },
  {
    resourceType: "network",
    collection: "networks",
    listArgs: (runtimeName) => [
      "network",
      "ls",
      "-q",
      "--filter",
      `label=${COMPOSE_PROJECT_LABEL_KEY}=${runtimeName}`
    ],
    inspectArgs: (ids) => [
      "network",
      "inspect",
      "--format",
      buildInspectFormat(".Id", ".Labels"),
      ...ids
    ]
  },
  {
    resourceType: "volume",
    collection: "volumes",
    listArgs: (runtimeName) => [
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=${COMPOSE_PROJECT_LABEL_KEY}=${runtimeName}`
    ],
    inspectArgs: (ids) => [
      "volume",
      "inspect",
      "--format",
      buildInspectFormat(".Name", ".Labels"),
      ...ids
    ]
  }
];

// Swarm services, networks, configs, and secrets carry ownership labels from the Compose document.
// Volumes are node-local and are not removed as part of stack cleanup.
const swarmResourceSpecs: RuntimeResourceSpec[] = [
  {
    resourceType: "service",
    collection: "services",
    listArgs: (runtimeName) => [
      "service",
      "ls",
      "-q",
      "--filter",
      `label=${SWARM_STACK_LABEL_KEY}=${runtimeName}`
    ],
    inspectArgs: (ids) => [
      "service",
      "inspect",
      "--format",
      buildInspectFormat(".ID", ".Spec.Labels"),
      ...ids
    ]
  },
  {
    resourceType: "network",
    collection: "networks",
    listArgs: (runtimeName) => [
      "network",
      "ls",
      "-q",
      "--filter",
      `label=${SWARM_STACK_LABEL_KEY}=${runtimeName}`
    ],
    inspectArgs: (ids) => [
      "network",
      "inspect",
      "--format",
      buildInspectFormat(".Id", ".Labels"),
      ...ids
    ]
  },
  {
    resourceType: "config",
    collection: "configs",
    listArgs: (runtimeName) => [
      "config",
      "ls",
      "-q",
      "--filter",
      `label=${SWARM_STACK_LABEL_KEY}=${runtimeName}`
    ],
    inspectArgs: (ids) => [
      "config",
      "inspect",
      "--format",
      buildInspectFormat(".ID", ".Spec.Labels"),
      ...ids
    ]
  },
  {
    resourceType: "secret",
    collection: "secrets",
    listArgs: (runtimeName) => [
      "secret",
      "ls",
      "-q",
      "--filter",
      `label=${SWARM_STACK_LABEL_KEY}=${runtimeName}`
    ],
    inspectArgs: (ids) => [
      "secret",
      "inspect",
      "--format",
      buildInspectFormat(".ID", ".Spec.Labels"),
      ...ids
    ]
  }
];

function uniqueIds(stdout: string[]): string[] {
  return [...new Set(stdout.map((line) => line.trim()).filter(Boolean))];
}

function parseId(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    return null;
  }
}

function idsMatch(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function runtimeLabel(kind: RuntimeOwnershipKind, runtimeName: string): string {
  if (kind === "compose") return `Compose project "${runtimeName}"`;
  if (kind === "swarm") return `Swarm stack "${runtimeName}"`;
  return `Container "${runtimeName}"`;
}

function failOwnershipCheck(input: {
  kind: RuntimeOwnershipKind;
  runtimeName: string;
  resourceType: string;
  resourceId: string;
  reason: string;
}): Error {
  const article = input.reason === "unowned" || input.reason === "invalidly labeled" ? "an" : "a";
  return new Error(
    `${runtimeLabel(input.kind, input.runtimeName)} has ${article} ${input.reason} ${input.resourceType} (${input.resourceId}); refusing to modify it.`
  );
}

function assertMatchingOwnership(input: {
  kind: RuntimeOwnershipKind;
  runtimeName: string;
  resourceType: string;
  resourceId: string;
  labels: Record<string, string>;
  ownershipScopes: readonly DockerOwnershipIdentity[];
}): void {
  const parsed = readDockerOwnershipIdentity(input.labels);
  if (parsed.status === "unmanaged") {
    throw failOwnershipCheck({ ...input, reason: "unowned" });
  }
  if (parsed.status === "invalid") {
    throw failOwnershipCheck({ ...input, reason: "invalidly labeled" });
  }
  if (
    !input.ownershipScopes.some((scope) =>
      matchesDockerOwnership(parsed.identity, scope, { includeDeploymentId: false })
    )
  ) {
    throw failOwnershipCheck({ ...input, reason: "differently owned" });
  }
}

function requireSuccess(
  result: DockerCommandResult,
  action: string,
  kind: RuntimeOwnershipKind,
  runtimeName: string
): void {
  if (result.exitCode === 0) return;
  throw new Error(
    `Unable to verify ownership for ${runtimeLabel(kind, runtimeName)} while ${action} (exit code ${result.exitCode}).`
  );
}

async function assertResourceOwnership(input: {
  kind: ComposeRuntimeKind;
  runtimeName: string;
  ownershipScopes: readonly DockerOwnershipIdentity[];
  target: ExecutionTarget;
  onLog: OnLog;
  execute: DockerTargetExecutor;
  spec: RuntimeResourceSpec;
}): Promise<string[]> {
  const listed = await input.execute(
    input.target,
    input.spec.listArgs(input.runtimeName),
    input.onLog
  );
  requireSuccess(listed, `listing ${input.spec.resourceType}s`, input.kind, input.runtimeName);

  const ids = uniqueIds(listed.stdout);
  if (ids.length === 0) return [];

  const inspected = await input.execute(input.target, input.spec.inspectArgs(ids), input.onLog);
  requireSuccess(
    inspected,
    `inspecting ${input.spec.resourceType}s`,
    input.kind,
    input.runtimeName
  );

  const inspectedIds = new Set<string>();
  for (const line of inspected.stdout) {
    const fields = line.trim().split("\t");
    const resourceId = parseId(fields[0] ?? "");
    const labels = parseDockerOwnershipLabelFields(fields.slice(1));
    if (!resourceId || !labels) {
      throw new Error(
        `Unable to verify ownership for ${runtimeLabel(input.kind, input.runtimeName)} because a ${input.spec.resourceType} inspection was incomplete.`
      );
    }
    if (!ids.some((id) => idsMatch(resourceId, id))) {
      throw new Error(
        `Unable to verify ownership for ${runtimeLabel(input.kind, input.runtimeName)} because an unexpected ${input.spec.resourceType} was inspected.`
      );
    }
    inspectedIds.add(resourceId);
    assertMatchingOwnership({
      kind: input.kind,
      runtimeName: input.runtimeName,
      resourceType: input.spec.resourceType,
      resourceId,
      labels,
      ownershipScopes: input.ownershipScopes
    });
  }

  for (const id of ids) {
    if (![...inspectedIds].some((inspectedId) => idsMatch(inspectedId, id))) {
      throw new Error(
        `Unable to verify ownership for ${runtimeLabel(input.kind, input.runtimeName)} because a listed ${input.spec.resourceType} was not inspected.`
      );
    }
  }

  return [...inspectedIds];
}

function emptyOwnershipSnapshot(): ComposeRuntimeOwnershipSnapshot {
  return {
    containers: [],
    networks: [],
    volumes: [],
    services: [],
    configs: [],
    secrets: []
  };
}

export async function assertContainerRuntimeOwnership(input: {
  containerName: string;
  ownershipScopes: readonly DockerOwnershipIdentity[];
  target: ExecutionTarget;
  onLog: OnLog;
  execute: DockerTargetExecutor;
}): Promise<string | null> {
  if (input.ownershipScopes.length === 0) {
    throw new Error(
      `Unable to verify ownership for ${runtimeLabel("container", input.containerName)} without a DaoFlow ownership scope.`
    );
  }
  input.ownershipScopes.forEach((scope) => assertDockerOwnershipIdentity(scope));

  const inspected = await input.execute(
    input.target,
    [
      "inspect",
      "--type",
      "container",
      "--format",
      buildInspectFormat(".Id", ".Config.Labels"),
      input.containerName
    ],
    input.onLog
  );
  if (inspected.exitCode !== 0) {
    const failure = [...inspected.stderr, ...inspected.stdout].join(" ");
    if (/no such (object|container)/i.test(failure)) return null;
    requireSuccess(inspected, "inspecting the container", "container", input.containerName);
  }

  if (inspected.stdout.length !== 1) {
    throw new Error(
      `Unable to verify ownership for ${runtimeLabel("container", input.containerName)} because its inspection was incomplete.`
    );
  }
  const fields = inspected.stdout[0].trim().split("\t");
  const resourceId = parseId(fields[0] ?? "");
  const labels = parseDockerOwnershipLabelFields(fields.slice(1));
  if (!resourceId || !labels) {
    throw new Error(
      `Unable to verify ownership for ${runtimeLabel("container", input.containerName)} because its inspection was incomplete.`
    );
  }
  assertMatchingOwnership({
    kind: "container",
    runtimeName: input.containerName,
    resourceType: "runtime",
    resourceId,
    labels,
    ownershipScopes: input.ownershipScopes
  });
  return resourceId;
}

export async function assertComposeRuntimeOwnership(input: {
  kind: ComposeRuntimeKind;
  runtimeName: string;
  ownershipScopes: readonly DockerOwnershipIdentity[];
  target: ExecutionTarget;
  onLog: OnLog;
  execute: DockerTargetExecutor;
}): Promise<ComposeRuntimeOwnershipSnapshot> {
  if (input.ownershipScopes.length === 0) {
    throw new Error(
      `Unable to verify ownership for ${runtimeLabel(input.kind, input.runtimeName)} without a DaoFlow ownership scope.`
    );
  }
  input.ownershipScopes.forEach((scope) => assertDockerOwnershipIdentity(scope));
  if (input.kind === "swarm" && input.target.serverKind !== "docker-swarm-manager") {
    throw new Error(
      `Unable to verify ownership for ${runtimeLabel(input.kind, input.runtimeName)} on a non-Swarm target.`
    );
  }

  const snapshot = emptyOwnershipSnapshot();
  const specs = input.kind === "compose" ? composeResourceSpecs : swarmResourceSpecs;
  for (const spec of specs) {
    snapshot[spec.collection] = await assertResourceOwnership({ ...input, spec });
  }
  return snapshot;
}
