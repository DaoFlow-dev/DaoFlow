import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { DeploymentConclusion, DeploymentLifecycleStatus } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { deploymentLogs, deployments } from "../schema/deployments";
import { asRecord, readStringArray } from "./json-helpers";

const ACTIVE_DEPLOYMENT_STATUSES = [
  DeploymentLifecycleStatus.Prepare,
  DeploymentLifecycleStatus.Deploy,
  DeploymentLifecycleStatus.Finalize,
  DeploymentLifecycleStatus.Running
] as const;

type ActiveDeploymentStatus = (typeof ACTIVE_DEPLOYMENT_STATUSES)[number];

const DEFAULT_DEPLOYMENT_WATCHDOG_TIMEOUT_MS = 15 * 60_000;
const MIN_DEPLOYMENT_WATCHDOG_TIMEOUT_MS = 60_000;

export interface DeploymentWatchdogFailure {
  deploymentId: string;
  serviceName: string;
  previousStatus: string;
  lastHeartbeatAt: string;
  detectedAt: string;
  staleForMs: number;
  timeoutMs: number;
}

export interface DeploymentWatchdogRunResult {
  failedCount: number;
  failures: DeploymentWatchdogFailure[];
}

export interface DeploymentWatchdogCandidate {
  deploymentId: string;
  serviceName: string;
  previousStatus: string;
  lastHeartbeatAt: string;
  staleForMs: number;
  timeoutMs: number;
}

export function resolveDeploymentWatchdogTimeoutMs(
  rawValue = process.env.DEPLOYMENT_WATCHDOG_TIMEOUT_MS
): number {
  const parsed = Number(rawValue ?? DEFAULT_DEPLOYMENT_WATCHDOG_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed < MIN_DEPLOYMENT_WATCHDOG_TIMEOUT_MS) {
    return DEFAULT_DEPLOYMENT_WATCHDOG_TIMEOUT_MS;
  }

  return Math.floor(parsed);
}

function formatStaleDurationSummary(staleForMs: number): string {
  const staleMinutes = Math.max(1, Math.round(staleForMs / 60_000));
  return `${staleMinutes} minute${staleMinutes === 1 ? "" : "s"}`;
}

export async function listDeploymentWatchdogCandidates(input?: {
  now?: Date;
  timeoutMs?: number;
  limit?: number;
}): Promise<DeploymentWatchdogCandidate[]> {
  const now = input?.now ?? new Date();
  const timeoutMs = input?.timeoutMs ?? resolveDeploymentWatchdogTimeoutMs();
  const staleBefore = new Date(now.getTime() - timeoutMs);

  const candidates = await db
    .select()
    .from(deployments)
    .where(
      and(
        inArray(deployments.status, [...ACTIVE_DEPLOYMENT_STATUSES]),
        isNull(deployments.concludedAt),
        lt(deployments.updatedAt, staleBefore)
      )
    )
    .orderBy(asc(deployments.updatedAt))
    .limit(input?.limit ?? 8);

  return candidates.map((deployment) => ({
    deploymentId: deployment.id,
    serviceName: deployment.serviceName,
    previousStatus: deployment.status,
    lastHeartbeatAt: deployment.updatedAt.toISOString(),
    staleForMs: now.getTime() - deployment.updatedAt.getTime(),
    timeoutMs
  }));
}

function buildWatchdogInsight(input: {
  previousInsight: Record<string, unknown>;
  serviceName: string;
  previousStatus: string;
  lastHeartbeatAt: string;
  timeoutMs: number;
  staleForMs: number;
}) {
  const safeActions = Array.from(
    new Set([
      ...readStringArray(input.previousInsight, "safeActions"),
      "Inspect the deployment logs immediately before the stall.",
      "Verify the target server and Docker runtime are still reachable.",
      `Retry ${input.serviceName} after the runtime is responsive again.`
    ])
  );

  return {
    ...input.previousInsight,
    summary: `DaoFlow stopped waiting for ${input.serviceName} because deployment progress went silent for ${formatStaleDurationSummary(input.staleForMs)}.`,
    suspectedRootCause: `${input.serviceName} stopped reporting progress while ${input.previousStatus}. The watchdog marked the rollout failed after ${Math.round(input.timeoutMs / 60_000)} minutes without a heartbeat.`,
    safeActions,
    evidence: [
      {
        kind: "watchdog",
        id: "deployment-watchdog-timeout",
        title: "Progress heartbeat timed out",
        detail: `The last recorded deployment heartbeat was ${input.lastHeartbeatAt}.`
      }
    ]
  };
}

function isActiveDeploymentStatus(status: string): status is ActiveDeploymentStatus {
  return ACTIVE_DEPLOYMENT_STATUSES.some((candidate) => candidate === status);
}

async function markDeploymentFailedByWatchdog(input: {
  deployment: typeof deployments.$inferSelect;
  timeoutMs: number;
  now: Date;
}): Promise<DeploymentWatchdogFailure | null> {
  const current = input.deployment;
  if (!isActiveDeploymentStatus(current.status)) {
    return null;
  }

  const staleForMs = input.now.getTime() - current.updatedAt.getTime();
  const lastHeartbeatAt = current.updatedAt.toISOString();
  const detectedAt = input.now.toISOString();
  const previousStatus = current.status;
  const existingSnapshot = asRecord(current.configSnapshot);
  const previousInsight = asRecord(existingSnapshot.insight);
  const insight = buildWatchdogInsight({
    previousInsight,
    serviceName: current.serviceName,
    previousStatus,
    lastHeartbeatAt,
    timeoutMs: input.timeoutMs,
    staleForMs
  });

  const error = {
    code: "DEPLOYMENT_WATCHDOG_TIMEOUT",
    reason: "Deployment progress heartbeat timed out.",
    message: `${current.serviceName} stopped reporting progress while ${previousStatus}. DaoFlow marked the deployment failed after ${formatStaleDurationSummary(staleForMs)} without a heartbeat.`,
    previousStatus,
    lastHeartbeatAt,
    detectedAt,
    timeoutMs: input.timeoutMs
  };

  const configSnapshot = {
    ...existingSnapshot,
    insight,
    watchdog: {
      detectedAt,
      previousStatus,
      lastHeartbeatAt,
      staleForMs,
      timeoutMs: input.timeoutMs
    }
  };

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(deployments)
      .set({
        status: DeploymentLifecycleStatus.Failed,
        conclusion: DeploymentConclusion.Failed,
        error,
        configSnapshot,
        concludedAt: input.now,
        updatedAt: input.now
      })
      .where(
        and(
          eq(deployments.id, current.id),
          inArray(deployments.status, [...ACTIVE_DEPLOYMENT_STATUSES])
        )
      )
      .returning({ id: deployments.id });

    if (!updated) {
      return null;
    }

    await tx.insert(deploymentLogs).values({
      deploymentId: current.id,
      level: "error",
      message: `${current.serviceName} stopped reporting progress while ${previousStatus}. DaoFlow marked the deployment failed after ${formatStaleDurationSummary(staleForMs)} without a heartbeat.`,
      source: "system",
      metadata: {
        source: "deployment-watchdog",
        previousStatus,
        lastHeartbeatAt,
        timeoutMs: input.timeoutMs
      },
      createdAt: input.now
    });

    await tx.insert(events).values({
      kind: "deployment.watchdog.failed",
      resourceType: "deployment",
      resourceId: current.id,
      summary: "Deployment failed after progress stalled.",
      detail: `${current.serviceName} stopped reporting progress while ${previousStatus}. Last heartbeat: ${lastHeartbeatAt}.`,
      severity: "error",
      metadata: {
        serviceName: current.serviceName,
        actorLabel: "deployment-watchdog",
        previousStatus,
        timeoutMs: input.timeoutMs
      },
      createdAt: input.now
    });

    await tx.insert(auditEntries).values({
      actorType: "system",
      actorId: "deployment-watchdog",
      actorEmail: "system@daoflow.local",
      actorRole: "admin",
      targetResource: `deployment/${current.id}`,
      action: "deployment.watchdog.fail",
      inputSummary: `Marked ${current.serviceName} failed after progress stalled.`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: {
        resourceType: "deployment",
        resourceId: current.id,
        resourceLabel: current.serviceName,
        detail: `${current.serviceName} stopped reporting progress while ${previousStatus}. Last heartbeat: ${lastHeartbeatAt}.`,
        previousStatus,
        timeoutMs: input.timeoutMs
      }
    });

    return {
      deploymentId: current.id,
      serviceName: current.serviceName,
      previousStatus,
      lastHeartbeatAt,
      detectedAt,
      staleForMs,
      timeoutMs: input.timeoutMs
    };
  });
}

export async function runDeploymentWatchdogOnce(input?: {
  now?: Date;
  timeoutMs?: number;
  limit?: number;
}): Promise<DeploymentWatchdogRunResult> {
  const now = input?.now ?? new Date();
  const timeoutMs = input?.timeoutMs ?? resolveDeploymentWatchdogTimeoutMs();
  const candidateIds = await listDeploymentWatchdogCandidates({
    now,
    timeoutMs,
    limit: input?.limit
  });
  const candidates =
    candidateIds.length === 0
      ? []
      : await db
          .select()
          .from(deployments)
          .where(
            inArray(
              deployments.id,
              candidateIds.map((candidate) => candidate.deploymentId)
            )
          )
          .orderBy(asc(deployments.updatedAt));

  const failures: DeploymentWatchdogFailure[] = [];
  for (const deployment of candidates) {
    const failure = await markDeploymentFailedByWatchdog({
      deployment,
      timeoutMs,
      now
    });
    if (failure) {
      failures.push(failure);
    }
  }

  return {
    failedCount: failures.length,
    failures
  };
}
