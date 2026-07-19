import { inArray } from "drizzle-orm";
import { readDockerOwnershipIdentity, type DockerOwnershipIdentity } from "../../docker-ownership";
import type {
  DockerOwnedResource,
  DockerOwnedResourceInspectionIssue,
  DockerOwnedResourceSnapshot,
  DockerOwnedResourceType
} from "../../worker/docker-owned-resource-inspection";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";

export type DockerOwnedResourceKind = DockerOwnedResourceType;

interface DockerOwnedResourceObservation extends DockerOwnedResource {
  kind: DockerOwnedResourceKind;
}

export type DockerOwnershipStatus = "valid" | "invalid" | "orphan" | "inconsistent";

export interface DockerOwnershipReconciliationEntry {
  kind: DockerOwnedResourceKind;
  id: string;
  name: string;
  status: DockerOwnershipStatus;
  ownership: DockerOwnershipIdentity | null;
  reasons: string[];
}

export interface DockerOwnershipReconciliationReport {
  checkedAt: string;
  serverId: string;
  summary: Record<DockerOwnershipStatus, number>;
  resources: DockerOwnershipReconciliationEntry[];
  inspectionErrors: DockerOwnedResourceInspectionIssue[];
}

export interface ValidDockerOwnedResource {
  kind: DockerOwnedResourceKind;
  id: string;
  name: string;
  ownership: DockerOwnershipIdentity;
}

interface ReconciliationIndex {
  projects: Map<string, typeof projects.$inferSelect>;
  environments: Map<string, typeof environments.$inferSelect>;
  services: Map<string, typeof services.$inferSelect>;
  deployments: Map<string, typeof deployments.$inferSelect>;
}

function readOwnershipIdentity(resource: DockerOwnedResourceObservation): {
  identity: DockerOwnershipIdentity | null;
  reasons: string[];
} {
  const parsed = readDockerOwnershipIdentity(resource.labels);
  if (parsed.status === "managed") return { identity: parsed.identity, reasons: [] };
  if (parsed.status === "invalid") return { identity: null, reasons: [parsed.reason] };
  return { identity: null, reasons: ["Managed Docker label is missing or false."] };
}

function flattenSnapshot(snapshot: DockerOwnedResourceSnapshot): DockerOwnedResourceObservation[] {
  const collections: Array<[DockerOwnedResourceKind, DockerOwnedResource[]]> = [
    ["container", snapshot.containers],
    ["image", snapshot.images],
    ["network", snapshot.networks],
    ["volume", snapshot.volumes],
    ["service", snapshot.services]
  ];

  return collections.flatMap(([kind, resources]) =>
    resources.map((resource) => ({ ...resource, kind }))
  );
}

function reconcileResource(input: {
  resource: DockerOwnedResourceObservation;
  identity: DockerOwnershipIdentity;
  expectedTeamId: string;
  serverId: string;
  index: ReconciliationIndex;
}): DockerOwnershipReconciliationEntry {
  const { resource, identity, expectedTeamId, serverId, index } = input;
  const reasons: string[] = [];
  let orphaned = false;

  if (identity.teamId !== expectedTeamId) reasons.push("team-scope-mismatch");

  const project = index.projects.get(identity.projectId);
  if (!project) {
    reasons.push("project-missing");
    orphaned = true;
  } else if (project.teamId !== identity.teamId) {
    reasons.push("project-team-mismatch");
  }

  const environment = index.environments.get(identity.environmentId);
  if (!environment) {
    reasons.push("environment-missing");
    orphaned = true;
  } else if (environment.projectId !== identity.projectId) {
    reasons.push("environment-project-mismatch");
  }

  const service = index.services.get(identity.serviceId);
  if (!service) {
    reasons.push("service-missing");
    orphaned = true;
  } else {
    if (service.projectId !== identity.projectId) reasons.push("service-project-mismatch");
    if (service.environmentId !== identity.environmentId) {
      reasons.push("service-environment-mismatch");
    }
    if (service.targetServerId && service.targetServerId !== serverId) {
      reasons.push("service-server-mismatch");
    }
  }

  const deployment = index.deployments.get(identity.deploymentId);
  if (!deployment) {
    reasons.push("deployment-missing");
    orphaned = true;
  } else {
    if (deployment.projectId !== identity.projectId) reasons.push("deployment-project-mismatch");
    if (deployment.environmentId !== identity.environmentId) {
      reasons.push("deployment-environment-mismatch");
    }
    if (deployment.targetServerId !== serverId) reasons.push("deployment-server-mismatch");
    if (deployment.serviceId !== identity.serviceId) {
      reasons.push("deployment-service-mismatch");
    }
  }

  return {
    kind: resource.kind,
    id: resource.id,
    name: resource.name,
    status: reasons.length === 0 ? "valid" : orphaned ? "orphan" : "inconsistent",
    ownership: identity,
    reasons: [...new Set(reasons)].sort()
  };
}

export function reconcileDockerOwnershipSnapshot(input: {
  snapshot: DockerOwnedResourceSnapshot;
  expectedTeamId: string;
  serverId: string;
  index: ReconciliationIndex;
}): DockerOwnershipReconciliationReport {
  const resources = flattenSnapshot(input.snapshot).map((resource) => {
    const parsed = readOwnershipIdentity(resource);
    if (!parsed.identity) {
      return {
        kind: resource.kind,
        id: resource.id,
        name: resource.name,
        status: "invalid" as const,
        ownership: null,
        reasons: parsed.reasons
      };
    }

    return reconcileResource({
      resource,
      identity: parsed.identity,
      expectedTeamId: input.expectedTeamId,
      serverId: input.serverId,
      index: input.index
    });
  });

  return {
    checkedAt: input.snapshot.checkedAt,
    serverId: input.serverId,
    summary: {
      valid: resources.filter((resource) => resource.status === "valid").length,
      invalid: resources.filter((resource) => resource.status === "invalid").length,
      orphan: resources.filter((resource) => resource.status === "orphan").length,
      inconsistent: resources.filter((resource) => resource.status === "inconsistent").length
    },
    resources,
    inspectionErrors: input.snapshot.issues
  };
}

export function selectValidDockerOwnedResources(
  report: DockerOwnershipReconciliationReport,
  scope?: {
    projectId?: string;
    deploymentIds?: string[];
    kinds?: DockerOwnedResourceKind[];
  }
): ValidDockerOwnedResource[] {
  const deploymentIds = scope?.deploymentIds ? new Set(scope.deploymentIds) : null;
  const kinds = scope?.kinds ? new Set(scope.kinds) : null;

  return report.resources
    .filter(
      (
        resource
      ): resource is DockerOwnershipReconciliationEntry & {
        status: "valid";
        ownership: DockerOwnershipIdentity;
      } => resource.status === "valid" && resource.ownership !== null
    )
    .filter((resource) => !scope?.projectId || resource.ownership.projectId === scope.projectId)
    .filter((resource) => !deploymentIds || deploymentIds.has(resource.ownership.deploymentId))
    .filter((resource) => !kinds || kinds.has(resource.kind))
    .map((resource) => ({
      kind: resource.kind,
      id: resource.id,
      name: resource.name,
      ownership: resource.ownership
    }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.id.localeCompare(right.id)
        : left.kind.localeCompare(right.kind)
    );
}

export async function reconcileDockerOwnership(input: {
  snapshot: DockerOwnedResourceSnapshot;
  expectedTeamId: string;
  serverId: string;
}): Promise<DockerOwnershipReconciliationReport> {
  const parsed = flattenSnapshot(input.snapshot)
    .map((resource) => readOwnershipIdentity(resource).identity)
    .filter((identity): identity is DockerOwnershipIdentity => identity !== null);
  const projectIds = [...new Set(parsed.map((identity) => identity.projectId))];
  const environmentIds = [...new Set(parsed.map((identity) => identity.environmentId))];
  const serviceIds = [...new Set(parsed.map((identity) => identity.serviceId))];
  const deploymentIds = [...new Set(parsed.map((identity) => identity.deploymentId))];
  const [projectRows, environmentRows, serviceRows, deploymentRows] = await Promise.all([
    projectIds.length ? db.select().from(projects).where(inArray(projects.id, projectIds)) : [],
    environmentIds.length
      ? db.select().from(environments).where(inArray(environments.id, environmentIds))
      : [],
    serviceIds.length ? db.select().from(services).where(inArray(services.id, serviceIds)) : [],
    deploymentIds.length
      ? db.select().from(deployments).where(inArray(deployments.id, deploymentIds))
      : []
  ]);

  return reconcileDockerOwnershipSnapshot({
    ...input,
    index: {
      projects: new Map(projectRows.map((row) => [row.id, row])),
      environments: new Map(environmentRows.map((row) => [row.id, row])),
      services: new Map(serviceRows.map((row) => [row.id, row])),
      deployments: new Map(deploymentRows.map((row) => [row.id, row]))
    }
  });
}
