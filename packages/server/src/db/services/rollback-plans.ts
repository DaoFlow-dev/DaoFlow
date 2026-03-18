import { and, desc, eq } from "drizzle-orm";
import {
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { listRollbackTargets } from "./execute-rollback";
import { resolveServiceForUser } from "./scoped-services";

export interface BuildRollbackPlanInput {
  serviceRef: string;
  targetDeploymentId?: string;
  requestedByUserId: string;
}

export async function buildRollbackPlan(input: BuildRollbackPlanInput) {
  const service = await resolveServiceForUser(input.serviceRef, input.requestedByUserId);
  const [project, environment, latestDeployment] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, service.projectId)).limit(1),
    db.select().from(environments).where(eq(environments.id, service.environmentId)).limit(1),
    db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.projectId, service.projectId),
          eq(deployments.environmentId, service.environmentId),
          eq(deployments.serviceName, service.name)
        )
      )
      .orderBy(desc(deployments.createdAt))
      .limit(1)
  ]);

  if (!project[0] || !environment[0]) {
    throw new Error(`Service "${service.name}" is missing its project or environment linkage.`);
  }

  const targets = await listRollbackTargets(service.id, input.requestedByUserId);
  const requestedTargetId = input.targetDeploymentId?.trim();
  const selectedTarget = requestedTargetId
    ? (targets.find((target) => target.deploymentId === requestedTargetId) ?? null)
    : (targets.find((target) => target.deploymentId !== latestDeployment[0]?.id) ?? null);

  if (requestedTargetId && !selectedTarget) {
    throw new Error(`Rollback target "${requestedTargetId}" is not available for this service.`);
  }

  const [targetServer] = selectedTarget
    ? await db
        .select()
        .from(servers)
        .where(eq(servers.id, latestDeployment[0]?.targetServerId ?? service.targetServerId ?? ""))
        .limit(1)
    : [];

  const checks = [
    latestDeployment[0]
      ? {
          status: "ok" as const,
          detail: `Current deployment is ${formatDeploymentStatusLabel(
            latestDeployment[0].status,
            latestDeployment[0].conclusion
          )}.`
        }
      : {
          status: "warn" as const,
          detail: "This service has no recorded current deployment yet."
        },
    targets.length > 0
      ? {
          status: "ok" as const,
          detail: `Found ${targets.length} successful rollback target${targets.length === 1 ? "" : "s"} within retention.`
        }
      : {
          status: "fail" as const,
          detail: "No successful rollback target is available for this service."
        },
    selectedTarget
      ? {
          status: "ok" as const,
          detail: `Selected rollback target ${selectedTarget.deploymentId} completed at ${selectedTarget.concludedAt ?? "an unknown time"}.`
        }
      : {
          status: "fail" as const,
          detail:
            requestedTargetId && targets.length > 0
              ? "The requested target is outside the scoped rollback window."
              : "Choose a specific rollback target to preview the execution plan."
        },
    latestDeployment[0] && selectedTarget && latestDeployment[0].id === selectedTarget.deploymentId
      ? {
          status: "fail" as const,
          detail: "The selected rollback target is already the current deployment."
        }
      : {
          status: "ok" as const,
          detail: targetServer
            ? `Execution will run against ${targetServer.name} (${targetServer.host}).`
            : "Execution will run against the service's configured target server."
        }
  ];

  const steps = selectedTarget
    ? [
        `Freeze the current deployment state for ${service.name}`,
        `Rehydrate runtime inputs from deployment ${selectedTarget.deploymentId}`,
        "Queue a new rollback deployment record with the preserved configuration",
        targetServer
          ? `Dispatch rollback execution to ${targetServer.name}`
          : "Dispatch rollback execution to the configured target server",
        "Run health checks before promoting the rollback as healthy"
      ]
    : [];

  return {
    isReady: checks.every((check) => check.status !== "fail"),
    service: {
      id: service.id,
      name: service.name,
      projectId: project[0].id,
      projectName: project[0].name,
      environmentId: environment[0].id,
      environmentName: environment[0].name
    },
    currentDeployment: latestDeployment[0]
      ? {
          id: latestDeployment[0].id,
          status: normalizeDeploymentStatus(
            latestDeployment[0].status,
            latestDeployment[0].conclusion
          ),
          statusLabel: formatDeploymentStatusLabel(
            latestDeployment[0].status,
            latestDeployment[0].conclusion
          ),
          statusTone: getDeploymentStatusTone(
            latestDeployment[0].status,
            latestDeployment[0].conclusion
          ),
          imageTag: latestDeployment[0].imageTag,
          commitSha: latestDeployment[0].commitSha,
          createdAt: latestDeployment[0].createdAt.toISOString(),
          finishedAt: latestDeployment[0].concludedAt?.toISOString() ?? null
        }
      : null,
    targetDeployment: selectedTarget
      ? {
          id: selectedTarget.deploymentId,
          imageTag: selectedTarget.imageTag,
          commitSha: selectedTarget.commitSha,
          concludedAt: selectedTarget.concludedAt
        }
      : null,
    availableTargets: targets,
    preflightChecks: checks,
    steps,
    executeCommand: selectedTarget
      ? `daoflow rollback --service ${service.id} --target ${selectedTarget.deploymentId} --yes`
      : `daoflow rollback --service ${service.id}`
  };
}
