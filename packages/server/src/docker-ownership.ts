export const DOCKER_MANAGED_LABEL_KEY = "io.daoflow.managed";
export const DOCKER_TEAM_ID_LABEL_KEY = "io.daoflow.team-id";
export const DOCKER_PROJECT_ID_LABEL_KEY = "io.daoflow.project-id";
export const DOCKER_ENVIRONMENT_ID_LABEL_KEY = "io.daoflow.environment-id";
export const DOCKER_SERVICE_ID_LABEL_KEY = "io.daoflow.service-id";
export const DOCKER_DEPLOYMENT_ID_LABEL_KEY = "io.daoflow.deployment-id";

export const DOCKER_OWNERSHIP_LABEL_KEYS = [
  DOCKER_MANAGED_LABEL_KEY,
  DOCKER_TEAM_ID_LABEL_KEY,
  DOCKER_PROJECT_ID_LABEL_KEY,
  DOCKER_ENVIRONMENT_ID_LABEL_KEY,
  DOCKER_SERVICE_ID_LABEL_KEY,
  DOCKER_DEPLOYMENT_ID_LABEL_KEY
] as const;

export type DockerOwnershipLabelKey = (typeof DOCKER_OWNERSHIP_LABEL_KEYS)[number];

export interface DockerOwnershipIdentity {
  teamId: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  deploymentId: string;
}

export type DockerOwnershipLabels = Record<DockerOwnershipLabelKey, string>;

export type DockerOwnershipParseResult =
  | { status: "unmanaged" }
  | { status: "invalid"; reason: string }
  | { status: "managed"; identity: DockerOwnershipIdentity };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

const identityFields = [
  ["teamId", DOCKER_TEAM_ID_LABEL_KEY],
  ["projectId", DOCKER_PROJECT_ID_LABEL_KEY],
  ["environmentId", DOCKER_ENVIRONMENT_ID_LABEL_KEY],
  ["serviceId", DOCKER_SERVICE_ID_LABEL_KEY],
  ["deploymentId", DOCKER_DEPLOYMENT_ID_LABEL_KEY]
] as const;

function isLabelMap(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDockerOwnershipIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

export function assertDockerOwnershipIdentity(
  identity: DockerOwnershipIdentity
): DockerOwnershipIdentity {
  for (const [field] of identityFields) {
    const value = identity[field];
    if (!isDockerOwnershipIdentifier(value)) {
      throw new Error(
        `Docker ownership ${field} must be a 1-32 character identifier containing only letters, numbers, underscores, or hyphens.`
      );
    }
  }
  return identity;
}

export function buildDockerOwnershipLabels(
  identity: DockerOwnershipIdentity
): DockerOwnershipLabels {
  const validIdentity = assertDockerOwnershipIdentity(identity);
  return {
    [DOCKER_MANAGED_LABEL_KEY]: "true",
    [DOCKER_TEAM_ID_LABEL_KEY]: validIdentity.teamId,
    [DOCKER_PROJECT_ID_LABEL_KEY]: validIdentity.projectId,
    [DOCKER_ENVIRONMENT_ID_LABEL_KEY]: validIdentity.environmentId,
    [DOCKER_SERVICE_ID_LABEL_KEY]: validIdentity.serviceId,
    [DOCKER_DEPLOYMENT_ID_LABEL_KEY]: validIdentity.deploymentId
  };
}

export function readDockerOwnershipIdentity(labels: unknown): DockerOwnershipParseResult {
  if (!isLabelMap(labels) || labels[DOCKER_MANAGED_LABEL_KEY] !== "true") {
    return { status: "unmanaged" };
  }

  const identity = {} as DockerOwnershipIdentity;
  for (const [field, labelKey] of identityFields) {
    const value = labels[labelKey];
    if (typeof value !== "string" || !isDockerOwnershipIdentifier(value)) {
      return {
        status: "invalid",
        reason: `Managed Docker resource has an invalid ${labelKey} label.`
      };
    }
    identity[field] = value;
  }

  return { status: "managed", identity };
}

export function matchesDockerOwnership(
  actual: DockerOwnershipIdentity,
  expected: DockerOwnershipIdentity,
  options: { includeDeploymentId?: boolean } = {}
): boolean {
  return (
    actual.teamId === expected.teamId &&
    actual.projectId === expected.projectId &&
    actual.environmentId === expected.environmentId &&
    actual.serviceId === expected.serviceId &&
    (options.includeDeploymentId === false || actual.deploymentId === expected.deploymentId)
  );
}
