import {
  DeploymentHealthStatus,
  DeploymentLifecycleStatus,
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { buildDeploymentIndex } from "./deployment-record-views";
import { asRecord, readRecordArray, readString, readStringArray } from "./json-helpers";

export async function listDeploymentInsights(limit = 6) {
  const rows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.status, DeploymentLifecycleStatus.Failed))
    .orderBy(desc(deployments.createdAt))
    .limit(limit);

  const index = await buildDeploymentIndex(rows);

  return rows.map((deployment) => {
    const snapshot = asRecord(deployment.configSnapshot);
    const insight = asRecord(snapshot.insight);
    const healthyBaseline = asRecord(insight.healthyBaseline);
    const status = normalizeDeploymentStatus(deployment.status, deployment.conclusion);

    return {
      deploymentId: deployment.id,
      projectName:
        index.projectById.get(deployment.projectId)?.name ??
        readString(snapshot, "projectName", deployment.projectId),
      environmentName:
        index.environmentById.get(deployment.environmentId)?.name ??
        readString(snapshot, "environmentName", deployment.environmentId),
      serviceName: deployment.serviceName,
      status,
      statusTone: getDeploymentStatusTone(deployment.status, deployment.conclusion),
      statusLabel: formatDeploymentStatusLabel(deployment.status, deployment.conclusion),
      summary: readString(insight, "summary", `Deployment ${deployment.id} failed.`),
      suspectedRootCause: readString(
        insight,
        "suspectedRootCause",
        typeof deployment.error === "object" && deployment.error
          ? readString(asRecord(deployment.error), "suspectedRootCause", "Unknown")
          : "Unknown"
      ),
      safeActions: readStringArray(insight, "safeActions"),
      evidence: readRecordArray(insight, "evidence").map((item) => ({
        kind: readString(item, "kind"),
        id: readString(item, "id"),
        title: readString(item, "title"),
        detail: readString(item, "detail")
      })),
      healthyBaseline:
        Object.keys(healthyBaseline).length > 0
          ? {
              deploymentId: readString(healthyBaseline, "deploymentId"),
              commitSha: readString(healthyBaseline, "commitSha"),
              imageTag: readString(healthyBaseline, "imageTag"),
              finishedAt:
                typeof healthyBaseline.finishedAt === "string" ? healthyBaseline.finishedAt : null
            }
          : null
    };
  });
}

export async function listDeploymentRollbackPlans(limit = 6) {
  const rows = await db
    .select()
    .from(deployments)
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
  const index = await buildDeploymentIndex(rows);

  return rows.map((deployment) => {
    const snapshot = asRecord(deployment.configSnapshot);
    const rollbackPlan = asRecord(snapshot.rollbackPlan);
    const currentStatus = normalizeDeploymentStatus(deployment.status, deployment.conclusion);
    const currentStatusTone = getDeploymentStatusTone(deployment.status, deployment.conclusion);
    const currentStatusLabel = formatDeploymentStatusLabel(
      deployment.status,
      deployment.conclusion
    );

    if (Object.keys(rollbackPlan).length > 0) {
      const isAvailable = rollbackPlan.isAvailable !== false;

      return {
        deploymentId: deployment.id,
        projectName:
          index.projectById.get(deployment.projectId)?.name ??
          readString(snapshot, "projectName", deployment.projectId),
        environmentName:
          index.environmentById.get(deployment.environmentId)?.name ??
          readString(snapshot, "environmentName", deployment.environmentId),
        serviceName: deployment.serviceName,
        currentStatus,
        currentStatusTone,
        currentStatusLabel,
        isAvailable,
        planStatusTone: isAvailable ? DeploymentHealthStatus.Queued : currentStatusTone,
        planStatusLabel: isAvailable ? "Planned" : currentStatusLabel,
        reason: readString(rollbackPlan, "reason"),
        targetDeploymentId: readString(rollbackPlan, "targetDeploymentId", ""),
        targetCommitSha: readString(rollbackPlan, "targetCommitSha", ""),
        targetImageTag: readString(rollbackPlan, "targetImageTag", ""),
        checks: readStringArray(rollbackPlan, "checks"),
        steps: readStringArray(rollbackPlan, "steps")
      };
    }

    if (currentStatus === DeploymentHealthStatus.Healthy) {
      return {
        deploymentId: deployment.id,
        projectName:
          index.projectById.get(deployment.projectId)?.name ??
          readString(snapshot, "projectName", deployment.projectId),
        environmentName:
          index.environmentById.get(deployment.environmentId)?.name ??
          readString(snapshot, "environmentName", deployment.environmentId),
        serviceName: deployment.serviceName,
        currentStatus,
        currentStatusTone,
        currentStatusLabel,
        isAvailable: false,
        planStatusTone: currentStatusTone,
        planStatusLabel: currentStatusLabel,
        reason: "Current deployment is already healthy; rollback is not recommended.",
        targetDeploymentId: "",
        targetCommitSha: "",
        targetImageTag: "",
        checks: ["Continue observing logs and readiness checks before taking action."],
        steps: ["No rollback steps are suggested while the deployment remains healthy."]
      };
    }

    return {
      deploymentId: deployment.id,
      projectName:
        index.projectById.get(deployment.projectId)?.name ??
        readString(snapshot, "projectName", deployment.projectId),
      environmentName:
        index.environmentById.get(deployment.environmentId)?.name ??
        readString(snapshot, "environmentName", deployment.environmentId),
      serviceName: deployment.serviceName,
      currentStatus,
      currentStatusTone,
      currentStatusLabel,
      isAvailable: false,
      planStatusTone: currentStatusTone,
      planStatusLabel: currentStatusLabel,
      reason: "No deterministic rollback target is available yet.",
      targetDeploymentId: "",
      targetCommitSha: "",
      targetImageTag: "",
      checks: ["Capture a healthy baseline before offering rollback automation."],
      steps: ["Promote one deployment to healthy before constructing a rollback plan."]
    };
  });
}
