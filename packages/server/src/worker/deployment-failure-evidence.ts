import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { events } from "../db/schema/audit";
import { deploymentLogs, deployments } from "../db/schema/deployments";
import { asRecord, readRecordArray, readStringArray } from "../db/services/json-helpers";
import type { DeploymentRow } from "./step-management";

const MAX_FAILURE_MESSAGE_LENGTH = 500;
const SECRET_VALUE_PATTERN =
  /(?:Bearer\s+[^\s,;]+|(?:password|secret|token|authorization)\s*[=:]\s*[^\s,;]+|gh[pousr]_[A-Za-z0-9_]+|glpat-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gi;

export function safeDeploymentFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(SECRET_VALUE_PATTERN, "[redacted]")
    .trim()
    .slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

function readEvidenceIds(evidence: Record<string, unknown>) {
  return {
    eventId: typeof evidence.eventId === "number" ? evidence.eventId : null,
    logId: typeof evidence.logId === "number" ? evidence.logId : null
  };
}

export async function recordDeploymentFailureEvidence(
  deployment: DeploymentRow,
  error: unknown,
  actorLabel: string
): Promise<{ eventId: number; logId: number }> {
  const safeMessage = safeDeploymentFailureMessage(error) || "Deployment execution failed.";

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(deployments)
      .where(eq(deployments.id, deployment.id))
      .for("update")
      .limit(1);
    if (!current) {
      throw new Error(`Deployment ${deployment.id} not found while recording failure evidence.`);
    }

    const snapshot = asRecord(current.configSnapshot);
    const previousInsight = asRecord(snapshot.insight);
    const previousEvidence = readRecordArray(previousInsight, "evidence");
    const existing = previousEvidence.find((item) => item.kind === "worker-failure");
    if (existing) {
      const ids = readEvidenceIds(existing);
      if (ids.eventId !== null && ids.logId !== null) {
        return { eventId: ids.eventId, logId: ids.logId };
      }
    }

    const now = new Date();
    const [logRow] = await tx
      .insert(deploymentLogs)
      .values({
        deploymentId: current.id,
        level: "error",
        message: safeMessage,
        source: actorLabel,
        metadata: { source: "deployment-worker-failure" },
        createdAt: now
      })
      .returning({ id: deploymentLogs.id });
    const [eventRow] = await tx
      .insert(events)
      .values({
        kind: "deployment.failed",
        resourceType: "deployment",
        resourceId: current.id,
        summary: "Deployment failed in the execution worker.",
        detail: safeMessage,
        severity: "error",
        metadata: {
          serviceName: current.serviceName,
          actorLabel
        },
        createdAt: now
      })
      .returning({ id: events.id });
    if (!logRow || !eventRow) {
      throw new Error("Deployment failure evidence could not be persisted.");
    }

    const safeActions = Array.from(
      new Set([
        ...readStringArray(previousInsight, "safeActions"),
        "Inspect the cited deployment log and event before retrying.",
        "Verify the target server and Docker runtime are reachable.",
        "Compare the failed release with the last healthy deployment before rollback."
      ])
    );
    const insight = {
      ...previousInsight,
      summary: `${current.serviceName} failed during deployment execution.`,
      suspectedRootCause: safeMessage,
      safeActions,
      evidence: [
        ...previousEvidence.filter((item) => item.kind !== "worker-failure"),
        {
          kind: "worker-failure",
          id: `deployment-failure-${current.id}`,
          eventId: eventRow.id,
          logId: logRow.id,
          title: "Execution worker reported a failure",
          detail: safeMessage
        }
      ]
    };

    await tx
      .update(deployments)
      .set({
        configSnapshot: {
          ...snapshot,
          insight
        },
        updatedAt: now
      })
      .where(eq(deployments.id, current.id));

    return { eventId: eventRow.id, logId: logRow.id };
  });
}
