import { deployments } from "../schema/deployments";
import { asRecord, readRecordArray, readString, readStringArray } from "./json-helpers";

type DeploymentRow = typeof deployments.$inferSelect;

export interface DeploymentRecoveryGuidanceEvidence {
  kind: string;
  id: string;
  eventId: number | null;
  logId: number | null;
  title: string;
  detail: string;
}

export interface DeploymentRecoveryGuidance {
  source: "watchdog" | "deployment-insight";
  summary: string;
  suspectedRootCause: string | null;
  safeActions: string[];
  evidence: DeploymentRecoveryGuidanceEvidence[];
  evidenceIds: string[];
}

export function buildDeploymentRecoveryGuidance(
  deployment: DeploymentRow
): DeploymentRecoveryGuidance | null {
  const snapshot = asRecord(deployment.configSnapshot);
  const insight = asRecord(snapshot.insight);
  const error = asRecord(deployment.error);
  const evidence = readRecordArray(insight, "evidence").map((item) => ({
    kind: readString(item, "kind"),
    id: readString(item, "id"),
    eventId: typeof item.eventId === "number" ? item.eventId : null,
    logId: typeof item.logId === "number" ? item.logId : null,
    title: readString(item, "title"),
    detail: readString(item, "detail")
  }));
  const summary =
    readString(insight, "summary") ||
    readString(error, "message") ||
    readString(error, "reason") ||
    null;
  const suspectedRootCause =
    readString(insight, "suspectedRootCause") ||
    readString(error, "reason") ||
    readString(error, "detail") ||
    null;
  const safeActions = readStringArray(insight, "safeActions");

  if (!summary && !suspectedRootCause && safeActions.length === 0 && evidence.length === 0) {
    return null;
  }

  return {
    source:
      readString(error, "code") === "DEPLOYMENT_WATCHDOG_TIMEOUT"
        ? "watchdog"
        : "deployment-insight",
    summary: summary ?? "Deployment failed and needs operator attention.",
    suspectedRootCause,
    safeActions,
    evidence,
    evidenceIds: evidence.flatMap((item) => [
      ...(item.eventId === null ? [] : [`event:${item.eventId}`]),
      ...(item.logId === null ? [] : [`deployment-log:${item.logId}`])
    ])
  };
}
