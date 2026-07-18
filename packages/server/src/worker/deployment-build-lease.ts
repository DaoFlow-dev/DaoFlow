import { randomUUID } from "node:crypto";
import {
  DEFAULT_BUILD_LEASE_DURATION_MS,
  isDeploymentActiveForBuild,
  markDeploymentBuildSlotAcquired,
  markDeploymentWaitingForBuildSlot,
  releaseDeploymentBuildLease,
  renewDeploymentBuildLease,
  tryAcquireDeploymentBuildLease
} from "../db/services/deployment-build-capacity";
import { throwIfDeploymentCancellationRequested } from "../db/services/deployment-execution-control";
import type { OnLog } from "./docker-executor";

const DEFAULT_BUILD_LEASE_HEARTBEAT_MS = 30_000;
const DEFAULT_BUILD_LEASE_RETRY_MS = 1_000;

export class DeploymentBuildLeaseTerminalError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment ${deploymentId} became terminal while waiting for a build slot.`);
    this.name = "DeploymentBuildLeaseTerminalError";
  }
}

export class DeploymentBuildLeaseLostError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment ${deploymentId} lost ownership of its build slot.`);
    this.name = "DeploymentBuildLeaseLostError";
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeBuildLeaseLog(onLog: OnLog, message: string): void {
  onLog({ stream: "stdout", message, timestamp: new Date() });
}

function writeBuildLeaseError(onLog: OnLog, message: string): void {
  onLog({ stream: "stderr", message, timestamp: new Date() });
}

export async function withDeploymentBuildLease<T>(input: {
  deploymentId: string;
  serverId: string;
  onLog: OnLog;
  run: (signal: AbortSignal) => Promise<T>;
  ownerToken?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  retryIntervalMs?: number;
  renewLease?: typeof renewDeploymentBuildLease;
  signal?: AbortSignal;
}): Promise<T> {
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_BUILD_LEASE_DURATION_MS;
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? DEFAULT_BUILD_LEASE_HEARTBEAT_MS;
  const retryIntervalMs = input.retryIntervalMs ?? DEFAULT_BUILD_LEASE_RETRY_MS;
  const renewLease = input.renewLease ?? renewDeploymentBuildLease;
  const ownerToken = input.ownerToken ?? randomUUID();
  let waitingLogged = false;
  let lastWaitingHeartbeatAt = Date.now();

  await markDeploymentWaitingForBuildSlot(input.deploymentId);

  while (true) {
    input.signal?.throwIfAborted();
    await throwIfDeploymentCancellationRequested(input.deploymentId);
    if (!(await isDeploymentActiveForBuild(input.deploymentId))) {
      throw new DeploymentBuildLeaseTerminalError(input.deploymentId);
    }

    const lease = await tryAcquireDeploymentBuildLease({
      deploymentId: input.deploymentId,
      serverId: input.serverId,
      ownerToken,
      leaseDurationMs
    });

    if (lease.status === "server-not-found") {
      throw new Error(`Target server ${input.serverId} not found while acquiring a build slot.`);
    }

    if (lease.status === "waiting") {
      if (!waitingLogged) {
        waitingLogged = true;
        writeBuildLeaseLog(
          input.onLog,
          `Waiting for an available build slot on the target server (queue position ${lease.queuePosition}).`
        );
      }
      const now = Date.now();
      if (now - lastWaitingHeartbeatAt >= Math.min(heartbeatIntervalMs, 30_000)) {
        await markDeploymentWaitingForBuildSlot(input.deploymentId, new Date(now));
        lastWaitingHeartbeatAt = now;
      }
      await wait(retryIntervalMs);
      continue;
    }

    await markDeploymentBuildSlotAcquired(input.deploymentId);

    await throwIfDeploymentCancellationRequested(input.deploymentId);
    if (!(await isDeploymentActiveForBuild(input.deploymentId))) {
      await releaseDeploymentBuildLease({
        deploymentId: input.deploymentId,
        serverId: input.serverId,
        ownerToken
      });
      throw new DeploymentBuildLeaseTerminalError(input.deploymentId);
    }

    writeBuildLeaseLog(input.onLog, "Acquired a build slot on the target server.");
    const abortController = new AbortController();
    const abortFromExternalSignal = () => abortController.abort(input.signal?.reason);
    if (input.signal?.aborted) {
      abortFromExternalSignal();
    } else {
      input.signal?.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
    let leaseLost: DeploymentBuildLeaseLostError | null = null;
    let leaseOwnershipLost = false;
    let heartbeatRunning = false;
    let finished = false;
    let leaseExpiryWatchdog: NodeJS.Timeout | undefined;
    const abortForLeaseLoss = () => {
      if (finished || leaseOwnershipLost) return;
      leaseLost = new DeploymentBuildLeaseLostError(input.deploymentId);
      leaseOwnershipLost = true;
      writeBuildLeaseError(input.onLog, leaseLost.message);
      abortController.abort(leaseLost);
    };
    const armLeaseExpiryWatchdog = () => {
      if (leaseExpiryWatchdog) clearTimeout(leaseExpiryWatchdog);
      const safetyWindowMs = Math.max(
        1,
        Math.min(leaseDurationMs - 1, leaseDurationMs - heartbeatIntervalMs)
      );
      leaseExpiryWatchdog = setTimeout(abortForLeaseLoss, safetyWindowMs);
    };
    armLeaseExpiryWatchdog();
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || leaseLost) return;
      heartbeatRunning = true;
      void renewLease({
        deploymentId: input.deploymentId,
        serverId: input.serverId,
        ownerToken,
        leaseDurationMs
      })
        .then((renewed) => {
          if (finished) return;
          if (renewed) {
            armLeaseExpiryWatchdog();
            return;
          }
          abortForLeaseLoss();
        })
        .catch(abortForLeaseLoss)
        .finally(() => {
          heartbeatRunning = false;
        });
    }, heartbeatIntervalMs);

    const buildPromise = Promise.resolve().then(() => input.run(abortController.signal));
    try {
      const result = await buildPromise;
      if (leaseOwnershipLost) {
        throw new DeploymentBuildLeaseLostError(input.deploymentId);
      }
      return result;
    } finally {
      finished = true;
      clearInterval(heartbeat);
      if (leaseExpiryWatchdog) clearTimeout(leaseExpiryWatchdog);
      input.signal?.removeEventListener("abort", abortFromExternalSignal);
      try {
        await releaseDeploymentBuildLease({
          deploymentId: input.deploymentId,
          serverId: input.serverId,
          ownerToken
        });
      } catch {
        writeBuildLeaseError(
          input.onLog,
          `Unable to release the build slot for deployment ${input.deploymentId}; it will expire automatically.`
        );
      }
    }
  }
}
