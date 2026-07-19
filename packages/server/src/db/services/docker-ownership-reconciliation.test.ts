import { describe, expect, it } from "vitest";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import type {
  DockerOwnedResource,
  DockerOwnedResourceInspectionIssue,
  DockerOwnedResourceSnapshot,
  DockerOwnedResourceType
} from "../../worker/docker-owned-resource-inspection";
import {
  reconcileDockerOwnershipSnapshot,
  selectValidDockerOwnedResources
} from "./docker-ownership-reconciliation";

const identity = {
  teamId: "team_foundation",
  projectId: "project_foundation",
  environmentId: "env_foundation_prod",
  serviceId: "service_foundation_api",
  deploymentId: "deployment_foundation_api"
};

function ownershipLabels(overrides: Record<string, string> = {}) {
  return {
    "io.daoflow.managed": "true",
    "io.daoflow.team-id": identity.teamId,
    "io.daoflow.project-id": identity.projectId,
    "io.daoflow.environment-id": identity.environmentId,
    "io.daoflow.service-id": identity.serviceId,
    "io.daoflow.deployment-id": identity.deploymentId,
    ...overrides
  };
}

type TestObservation = DockerOwnedResource & { kind: DockerOwnedResourceType };

function observation(overrides: Partial<TestObservation> = {}): TestObservation {
  return {
    kind: "container",
    id: "container-1",
    name: "foundation-api",
    labels: ownershipLabels(),
    ...overrides
  };
}

function snapshot(
  resources: TestObservation[],
  issues: DockerOwnedResourceInspectionIssue[] = []
): DockerOwnedResourceSnapshot {
  const collect = (kind: DockerOwnedResourceType): DockerOwnedResource[] =>
    resources
      .filter((resource) => resource.kind === kind)
      .map(({ id, name, labels }) => ({ id, name, labels }));
  return {
    checkedAt: "2026-07-18T12:00:00.000Z",
    containers: collect("container"),
    images: collect("image"),
    networks: collect("network"),
    volumes: collect("volume"),
    services: collect("service"),
    issues
  };
}

function reconciliationIndex() {
  return {
    projects: new Map([
      [
        identity.projectId,
        {
          id: identity.projectId,
          teamId: identity.teamId
        } as typeof projects.$inferSelect
      ]
    ]),
    environments: new Map([
      [
        identity.environmentId,
        {
          id: identity.environmentId,
          projectId: identity.projectId
        } as typeof environments.$inferSelect
      ]
    ]),
    services: new Map([
      [
        identity.serviceId,
        {
          id: identity.serviceId,
          name: "api",
          projectId: identity.projectId,
          environmentId: identity.environmentId,
          targetServerId: "srv_foundation_1",
          sourceType: "compose"
        } as typeof services.$inferSelect
      ]
    ]),
    deployments: new Map([
      [
        identity.deploymentId,
        {
          id: identity.deploymentId,
          projectId: identity.projectId,
          environmentId: identity.environmentId,
          targetServerId: "srv_foundation_1",
          serviceId: identity.serviceId,
          serviceName: "api",
          sourceType: "compose"
        } as typeof deployments.$inferSelect
      ]
    ])
  };
}

describe("reconcileDockerOwnershipSnapshot", () => {
  it("resolves fully consistent ownership labels", () => {
    const report = reconcileDockerOwnershipSnapshot({
      snapshot: snapshot([observation()]),
      expectedTeamId: identity.teamId,
      serverId: "srv_foundation_1",
      index: reconciliationIndex()
    });

    expect(report.summary).toEqual({ valid: 1, invalid: 0, orphan: 0, inconsistent: 0 });
    expect(report.resources[0]).toMatchObject({
      status: "valid",
      ownership: identity,
      reasons: []
    });
  });

  it("reports malformed or missing identifiers without looking them up", () => {
    const report = reconcileDockerOwnershipSnapshot({
      snapshot: snapshot([
        observation({
          labels: ownershipLabels({ "io.daoflow.deployment-id": "secret/value" })
        })
      ]),
      expectedTeamId: identity.teamId,
      serverId: "srv_foundation_1",
      index: reconciliationIndex()
    });

    expect(report.summary.invalid).toBe(1);
    expect(report.resources[0]).toMatchObject({
      status: "invalid",
      ownership: null,
      reasons: ["Managed Docker resource has an invalid io.daoflow.deployment-id label."]
    });
  });

  it("separates missing records from inconsistent relationships", () => {
    const index = reconciliationIndex();
    index.deployments.clear();
    const orphan = reconcileDockerOwnershipSnapshot({
      snapshot: snapshot([observation()]),
      expectedTeamId: identity.teamId,
      serverId: "srv_foundation_1",
      index
    });

    expect(orphan.resources[0]).toMatchObject({
      status: "orphan",
      reasons: ["deployment-missing"]
    });

    const inconsistentIndex = reconciliationIndex();
    const [service] = inconsistentIndex.services.values();
    inconsistentIndex.services.set(identity.serviceId, {
      ...service,
      projectId: "project_other"
    });
    const inconsistent = reconcileDockerOwnershipSnapshot({
      snapshot: snapshot(
        [observation()],
        [{ resourceType: "image", code: "command-failed", exitCode: 1 }]
      ),
      expectedTeamId: identity.teamId,
      serverId: "srv_foundation_1",
      index: inconsistentIndex
    });

    expect(inconsistent.resources[0]).toMatchObject({
      status: "inconsistent",
      reasons: ["service-project-mismatch"]
    });
    expect(inconsistent.inspectionErrors).toEqual([
      { resourceType: "image", code: "command-failed", exitCode: 1 }
    ]);

    const serviceLinkIndex = reconciliationIndex();
    const [deployment] = serviceLinkIndex.deployments.values();
    serviceLinkIndex.deployments.set(identity.deploymentId, {
      ...deployment,
      serviceId: "service_other"
    });
    const serviceLinkMismatch = reconcileDockerOwnershipSnapshot({
      snapshot: snapshot([observation()]),
      expectedTeamId: identity.teamId,
      serverId: "srv_foundation_1",
      index: serviceLinkIndex
    });
    expect(serviceLinkMismatch.resources[0]).toMatchObject({
      status: "inconsistent",
      reasons: ["deployment-service-mismatch"]
    });
  });

  it("keeps immutable deployment ownership valid after mutable service fields change", () => {
    const index = reconciliationIndex();
    const [service] = index.services.values();
    index.services.set(identity.serviceId, {
      ...service,
      name: "renamed-api",
      sourceType: "image"
    });

    const report = reconcileDockerOwnershipSnapshot({
      snapshot: snapshot([observation()]),
      expectedTeamId: identity.teamId,
      serverId: "srv_foundation_1",
      index
    });

    expect(report.resources[0]).toMatchObject({
      status: "valid",
      reasons: []
    });
  });

  it("returns only exact valid IDs for downstream drift and cleanup plans", () => {
    const report = reconcileDockerOwnershipSnapshot({
      snapshot: snapshot([
        observation({ kind: "network", id: "network-b" }),
        observation({ kind: "container", id: "container-a" }),
        observation({
          kind: "image",
          id: "image-foreign-team",
          labels: ownershipLabels({ "io.daoflow.team-id": "team_other" })
        })
      ]),
      expectedTeamId: identity.teamId,
      serverId: "srv_foundation_1",
      index: reconciliationIndex()
    });

    expect(
      selectValidDockerOwnedResources(report, {
        projectId: identity.projectId,
        deploymentIds: [identity.deploymentId]
      }).map((resource) => `${resource.kind}:${resource.id}`)
    ).toEqual(["container:container-a", "network:network-b"]);
    expect(selectValidDockerOwnedResources(report, { kinds: ["image"] })).toEqual([]);
  });
});
