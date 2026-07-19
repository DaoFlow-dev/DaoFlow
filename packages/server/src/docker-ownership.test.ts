import { describe, expect, it } from "vitest";
import {
  DOCKER_DEPLOYMENT_ID_LABEL_KEY,
  DOCKER_ENVIRONMENT_ID_LABEL_KEY,
  DOCKER_MANAGED_LABEL_KEY,
  DOCKER_OWNERSHIP_LABEL_KEYS,
  DOCKER_PROJECT_ID_LABEL_KEY,
  DOCKER_SERVICE_ID_LABEL_KEY,
  DOCKER_TEAM_ID_LABEL_KEY,
  buildDockerOwnershipLabels,
  matchesDockerOwnership,
  readDockerOwnershipIdentity
} from "./docker-ownership";

const identity = {
  teamId: "team_123",
  projectId: "project_123",
  environmentId: "environment_123",
  serviceId: "service_123",
  deploymentId: "deployment_123"
};

describe("Docker ownership contract", () => {
  it("builds exactly the required identifier-only labels", () => {
    const labels = buildDockerOwnershipLabels(identity);

    expect(Object.keys(labels)).toEqual(DOCKER_OWNERSHIP_LABEL_KEYS);
    expect(labels).toEqual({
      [DOCKER_MANAGED_LABEL_KEY]: "true",
      [DOCKER_TEAM_ID_LABEL_KEY]: "team_123",
      [DOCKER_PROJECT_ID_LABEL_KEY]: "project_123",
      [DOCKER_ENVIRONMENT_ID_LABEL_KEY]: "environment_123",
      [DOCKER_SERVICE_ID_LABEL_KEY]: "service_123",
      [DOCKER_DEPLOYMENT_ID_LABEL_KEY]: "deployment_123"
    });
  });

  it("rejects invalid identifiers and distinguishes invalid managed labels", () => {
    expect(() => buildDockerOwnershipLabels({ ...identity, teamId: "team name" })).toThrow(
      "Docker ownership teamId"
    );
    expect(readDockerOwnershipIdentity({ [DOCKER_MANAGED_LABEL_KEY]: "true" })).toEqual({
      status: "invalid",
      reason: expect.stringContaining(DOCKER_TEAM_ID_LABEL_KEY)
    });
    expect(readDockerOwnershipIdentity({ unrelated: "label" })).toEqual({ status: "unmanaged" });
  });

  it("matches an existing managed resource without requiring its original deployment ID", () => {
    expect(
      matchesDockerOwnership({ ...identity, deploymentId: "deployment_old" }, identity, {
        includeDeploymentId: false
      })
    ).toBe(true);
    expect(matchesDockerOwnership({ ...identity, serviceId: "service_other" }, identity)).toBe(
      false
    );
  });
});
