import { formatDeploymentStatusLabel, getDeploymentStatusTone } from "@daoflow/shared";
import { getDeploymentRecord } from "./deployments";
import { asRecord } from "./json-helpers";
import { resolveTeamIdOrThrow } from "./scoped-services";
import { resolveDeploymentForTeam } from "./scoped-deployments";

function compareSnapshotValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface BuildConfigDiffInput {
  deploymentIdA: string;
  deploymentIdB: string;
  requestedByUserId: string;
}

export async function buildConfigDiff(input: BuildConfigDiffInput) {
  const teamId = await resolveTeamIdOrThrow(input.requestedByUserId);
  const [deploymentA, deploymentB] = await Promise.all([
    resolveDeploymentForTeam(input.deploymentIdA, teamId),
    resolveDeploymentForTeam(input.deploymentIdB, teamId)
  ]);

  const [a, b] = await Promise.all([
    getDeploymentRecord(deploymentA.id),
    getDeploymentRecord(deploymentB.id)
  ]);

  if (!a || !b) {
    return null;
  }

  const snapshotA = asRecord(a.configSnapshot);
  const snapshotB = asRecord(b.configSnapshot);
  const snapshotKeys = [...new Set([...Object.keys(snapshotA), ...Object.keys(snapshotB)])].sort();
  const snapshotChanges = snapshotKeys
    .filter((key) => !compareSnapshotValues(snapshotA[key], snapshotB[key]))
    .map((key) => ({
      key,
      baseline: snapshotA[key] ?? null,
      comparison: snapshotB[key] ?? null
    }));

  const scalarChanges = [
    {
      key: "commitSha",
      baseline: a.commitSha,
      comparison: b.commitSha
    },
    {
      key: "imageTag",
      baseline: a.imageTag,
      comparison: b.imageTag
    },
    {
      key: "sourceType",
      baseline: a.sourceType,
      comparison: b.sourceType
    },
    {
      key: "targetServerName",
      baseline: a.targetServerName,
      comparison: b.targetServerName
    },
    {
      key: "statusLabel",
      baseline: formatDeploymentStatusLabel(a.lifecycleStatus, a.conclusion),
      comparison: formatDeploymentStatusLabel(b.lifecycleStatus, b.conclusion)
    }
  ].filter((item) => item.baseline !== item.comparison);

  return {
    a: {
      id: a.id,
      projectName: a.projectName,
      environmentName: a.environmentName,
      serviceName: a.serviceName,
      status: a.status,
      statusLabel: formatDeploymentStatusLabel(a.lifecycleStatus, a.conclusion),
      statusTone: getDeploymentStatusTone(a.lifecycleStatus, a.conclusion),
      commitSha: a.commitSha,
      imageTag: a.imageTag,
      sourceType: a.sourceType,
      targetServerName: a.targetServerName,
      createdAt: a.createdAt,
      finishedAt: a.finishedAt,
      stepCount: a.steps.length
    },
    b: {
      id: b.id,
      projectName: b.projectName,
      environmentName: b.environmentName,
      serviceName: b.serviceName,
      status: b.status,
      statusLabel: formatDeploymentStatusLabel(b.lifecycleStatus, b.conclusion),
      statusTone: getDeploymentStatusTone(b.lifecycleStatus, b.conclusion),
      commitSha: b.commitSha,
      imageTag: b.imageTag,
      sourceType: b.sourceType,
      targetServerName: b.targetServerName,
      createdAt: b.createdAt,
      finishedAt: b.finishedAt,
      stepCount: b.steps.length
    },
    summary: {
      sameProject: a.projectId === b.projectId,
      sameEnvironment: a.environmentId === b.environmentId,
      sameService:
        (a.serviceId !== null && a.serviceId === b.serviceId) ||
        (a.projectId === b.projectId &&
          a.environmentId === b.environmentId &&
          a.serviceName === b.serviceName),
      changedScalarCount: scalarChanges.length,
      changedSnapshotKeyCount: snapshotChanges.length
    },
    scalarChanges,
    snapshotChanges
  };
}
