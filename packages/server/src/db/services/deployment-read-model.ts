import {
  DeploymentHealthStatus,
  StatusTone,
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { deployments, deploymentSteps } from "../schema/deployments";
import { services } from "../schema/services";
import {
  readComposeReadinessProbeFromConfig,
  readComposeReadinessProbeSnapshot
} from "../../compose-readiness";
import { asRecord, readString } from "./json-helpers";

type DeploymentRow = typeof deployments.$inferSelect;
type DeploymentStepRow = typeof deploymentSteps.$inferSelect;
type ServiceRow = typeof services.$inferSelect;

export interface DeploymentHealthSummary {
  status: "verified" | "failed" | "pending" | "not-configured";
  statusLabel: string;
  statusTone: StatusTone;
  summary: string;
  failureAnalysis: string | null;
  observedAt: string | null;
}

export interface RolloutStrategySummary {
  key: "compose-recreate" | "container-replace";
  label: string;
  summary: string;
  downtimeRisk: "possible" | "expected";
  supportsZeroDowntime: boolean;
  healthGate: "readiness-probe" | "docker-health" | "container-health";
}

export interface ServiceRuntimeSummary {
  status: "not-deployed" | "last-known-healthy" | "rollout-in-progress" | "attention";
  statusLabel: string;
  statusTone: StatusTone;
  summary: string;
  observedAt: string | null;
}

function readDeploymentErrorReason(deployment: DeploymentRow): string | null {
  if (!deployment.error || typeof deployment.error !== "object") {
    return null;
  }

  const error = asRecord(deployment.error);
  return (
    readString(error, "reason") ||
    readString(error, "message") ||
    readString(error, "detail") ||
    null
  );
}

function readInsightRootCause(snapshot: Record<string, unknown>): string | null {
  const insight = asRecord(snapshot.insight);
  return readString(insight, "suspectedRootCause") || readString(insight, "summary") || null;
}

function findHealthStep(steps: DeploymentStepRow[]): DeploymentStepRow | null {
  return [...steps].reverse().find((step) => step.label.toLowerCase().includes("health")) ?? null;
}

export function summarizeDeploymentHealth(input: {
  deployment: DeploymentRow;
  steps: DeploymentStepRow[];
}): DeploymentHealthSummary {
  const snapshot = asRecord(input.deployment.configSnapshot);
  const healthStep = findHealthStep(input.steps);
  const failureAnalysis =
    readInsightRootCause(snapshot) ?? readDeploymentErrorReason(input.deployment);

  if (healthStep) {
    if (healthStep.status === "completed") {
      return {
        status: "verified",
        statusLabel: "Health verified",
        statusTone: StatusTone.Healthy,
        summary: healthStep.detail ?? "Health checks passed.",
        failureAnalysis: null,
        observedAt:
          healthStep.completedAt?.toISOString() ?? healthStep.startedAt?.toISOString() ?? null
      };
    }

    if (healthStep.status === "failed") {
      return {
        status: "failed",
        statusLabel: "Health check failed",
        statusTone: StatusTone.Failed,
        summary: healthStep.detail ?? "Health checks failed.",
        failureAnalysis,
        observedAt:
          healthStep.completedAt?.toISOString() ?? healthStep.startedAt?.toISOString() ?? null
      };
    }

    return {
      status: "pending",
      statusLabel: "Health check pending",
      statusTone: StatusTone.Running,
      summary: healthStep.detail ?? "Waiting for health verification.",
      failureAnalysis: null,
      observedAt: healthStep.startedAt?.toISOString() ?? null
    };
  }

  const normalized = normalizeDeploymentStatus(
    input.deployment.status,
    input.deployment.conclusion
  );
  if (normalized === DeploymentHealthStatus.Healthy) {
    return {
      status: "verified",
      statusLabel: "Healthy",
      statusTone: StatusTone.Healthy,
      summary: "Deployment completed successfully.",
      failureAnalysis: null,
      observedAt: input.deployment.concludedAt?.toISOString() ?? null
    };
  }

  if (normalized === DeploymentHealthStatus.Failed) {
    return {
      status: "failed",
      statusLabel: "Failed",
      statusTone: StatusTone.Failed,
      summary: failureAnalysis ?? "Deployment failed before health verification completed.",
      failureAnalysis,
      observedAt: input.deployment.concludedAt?.toISOString() ?? null
    };
  }

  if (normalized === DeploymentHealthStatus.Running) {
    return {
      status: "pending",
      statusLabel: "In progress",
      statusTone: StatusTone.Running,
      summary: "Deployment is still running.",
      failureAnalysis: null,
      observedAt: null
    };
  }

  return {
    status: "not-configured",
    statusLabel: "Queued",
    statusTone: StatusTone.Queued,
    summary: "Deployment is queued and has not reached health verification yet.",
    failureAnalysis: null,
    observedAt: null
  };
}

export function summarizeRolloutStrategy(input: {
  sourceType: ServiceRow["sourceType"];
  serviceConfig?: unknown;
  deploymentSnapshot?: unknown;
  healthcheckPath?: string | null;
}): RolloutStrategySummary {
  const snapshotProbe = readComposeReadinessProbeSnapshot(
    asRecord(input.deploymentSnapshot).readinessProbe
  );
  const configProbe = readComposeReadinessProbeFromConfig(input.serviceConfig);
  const hasExplicitReadiness = snapshotProbe !== null || configProbe !== null;

  if (input.sourceType === "compose") {
    return {
      key: "compose-recreate",
      label: "Compose recreate",
      summary: hasExplicitReadiness
        ? "DaoFlow currently runs `docker compose up -d` and promotes the rollout only after Docker health and the configured readiness probe pass. This is health-gated, but it is not a true rolling or zero-downtime update."
        : input.healthcheckPath
          ? "DaoFlow currently runs `docker compose up -d` and waits for Docker Compose container state plus Docker health. The legacy healthcheck path is advisory only here, so zero-downtime is not guaranteed."
          : "DaoFlow currently runs `docker compose up -d` and waits for container state and Docker health. This does not guarantee zero-downtime or rolling replacement.",
      downtimeRisk: "possible",
      supportsZeroDowntime: false,
      healthGate: hasExplicitReadiness ? "readiness-probe" : "docker-health"
    };
  }

  return {
    key: "container-replace",
    label: "Container replace",
    summary:
      "DaoFlow currently replaces the target container and then waits for the container health gate to pass. This strategy may cause downtime during restarts.",
    downtimeRisk: "expected",
    supportsZeroDowntime: false,
    healthGate: "container-health"
  };
}

export function summarizeServiceRuntime(input: {
  latestDeployment: DeploymentRow | null;
  healthSummary: DeploymentHealthSummary | null;
  targetServerName?: string | null;
}): ServiceRuntimeSummary {
  if (!input.latestDeployment) {
    return {
      status: "not-deployed",
      statusLabel: "Not deployed",
      statusTone: StatusTone.Queued,
      summary: "No deployment record exists for this service yet.",
      observedAt: null
    };
  }

  const normalized = normalizeDeploymentStatus(
    input.latestDeployment.status,
    input.latestDeployment.conclusion
  );
  const targetLabel = input.targetServerName?.trim() ? ` on ${input.targetServerName}` : "";

  if (normalized === DeploymentHealthStatus.Healthy) {
    return {
      status: "last-known-healthy",
      statusLabel: "Last known healthy",
      statusTone: StatusTone.Healthy,
      summary:
        input.healthSummary?.summary ||
        `The latest rollout${targetLabel} completed and passed its health gate.`,
      observedAt: input.latestDeployment.concludedAt?.toISOString() ?? null
    };
  }

  if (normalized === DeploymentHealthStatus.Failed) {
    return {
      status: "attention",
      statusLabel: "Needs attention",
      statusTone: StatusTone.Failed,
      summary:
        input.healthSummary?.summary ||
        `The latest rollout${targetLabel} failed before reaching a healthy state.`,
      observedAt: input.latestDeployment.concludedAt?.toISOString() ?? null
    };
  }

  if (normalized === DeploymentHealthStatus.Running) {
    return {
      status: "rollout-in-progress",
      statusLabel: "Rollout in progress",
      statusTone: StatusTone.Running,
      summary:
        input.healthSummary?.summary || `The latest rollout${targetLabel} is still in progress.`,
      observedAt: null
    };
  }

  return {
    status: "rollout-in-progress",
    statusLabel: formatDeploymentStatusLabel(
      input.latestDeployment.status,
      input.latestDeployment.conclusion
    ),
    statusTone: getDeploymentStatusTone(
      input.latestDeployment.status,
      input.latestDeployment.conclusion
    ),
    summary: "The latest rollout has not reached a stable health verdict yet.",
    observedAt: null
  };
}
