import { Context } from "@temporalio/activity";

export const REMOTE_TRANSFER_HEARTBEAT_INTERVAL_MS = 30_000;

interface RemoteTransferActivityContext {
  heartbeat(): void;
  cancellationSignal: AbortSignal;
}

function currentActivityContext(): RemoteTransferActivityContext | undefined {
  try {
    return Context.current();
  } catch {
    return undefined;
  }
}

export async function runWithRemoteTransferActivity<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  activityContext = currentActivityContext()
): Promise<T> {
  const signal = activityContext?.cancellationSignal;
  throwIfCancelled(signal);
  if (!activityContext) return operation();

  activityContext.heartbeat();
  const heartbeatTimer = setInterval(() => {
    try {
      activityContext.heartbeat();
    } catch {
      // Cancellation is also delivered through the activity signal.
    }
  }, REMOTE_TRANSFER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  try {
    return await operation(signal);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Remote transfer was cancelled.");
}

export const remoteTransferActivityTestHooks = {
  runWithRemoteTransferActivity
};
