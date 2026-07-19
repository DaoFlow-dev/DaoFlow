import { Context } from "@temporalio/activity";

export const CONTROL_PLANE_RECOVERY_HEARTBEAT_INTERVAL_MS = 30_000;

interface ControlPlaneRecoveryActivityContext {
  heartbeat(): void;
  cancellationSignal: AbortSignal;
}

function currentRecoveryActivityContext(): ControlPlaneRecoveryActivityContext | undefined {
  try {
    return Context.current();
  } catch {
    return undefined;
  }
}

export async function runWithRecoveryActivityHeartbeat<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  activityContext = currentRecoveryActivityContext()
): Promise<T> {
  const signal = activityContext?.cancellationSignal;
  throwIfRecoveryCancelled(signal);
  if (!activityContext) return operation();

  activityContext.heartbeat();
  const heartbeatTimer = setInterval(() => {
    try {
      activityContext.heartbeat();
    } catch {
      // Temporal also delivers cancellation through the activity signal.
    }
  }, CONTROL_PLANE_RECOVERY_HEARTBEAT_INTERVAL_MS);
  try {
    return await operation(signal);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export function throwIfRecoveryCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Control-plane recovery was cancelled.");
}

export const controlPlaneRecoveryHeartbeatTestHooks = {
  runWithRecoveryActivityHeartbeat
};
