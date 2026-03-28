import { deployments } from "../schema/deployments";
import { asRecord, readRecordArray, readString, readStringArray } from "./json-helpers";

type DeploymentRow = typeof deployments.$inferSelect;

export interface DeploymentRecoveryGuidanceEvidence {
  kind: string;
  id: string;
  title: string;
  detail: string;
}

export interface DeploymentRecoveryGuidance {
  source: "watchdog" | "deployment-insight";
  summary: string;
  suspectedRootCause: string | null;
  safeActions: string[];
  evidence: DeploymentRecoveryGuidanceEvidence[];
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
    evidence
  };
}
