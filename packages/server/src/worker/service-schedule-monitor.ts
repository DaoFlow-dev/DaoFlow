import {
  acquireServiceScheduleMonitorLease,
  getServiceScheduleMonitorLeaseDurationMs,
  isCurrentServiceScheduleMonitorLease,
  releaseServiceScheduleMonitorLease,
  SERVICE_SCHEDULE_MONITOR_LEASE_KEY,
  type ServiceScheduleMonitorLease
} from "../db/services/service-schedule-lease";
import { newId } from "../db/services/json-helpers";
import { recoverStaleServiceScheduleRuns } from "../db/services/service-schedule-occurrences";
import { createDueServiceScheduleRuns } from "../db/services/service-schedules";
import { pollServiceScheduleRuns } from "./service-schedule-runner";
import { startServiceScheduleLeaseHeartbeat } from "./service-schedule-lease-heartbeat";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const MIN_POLL_INTERVAL_MS = 1_000;

const monitorInstanceId = resolveMonitorInstanceId();
let monitorLoop: Promise<void> | null = null;
let monitorAbortController: AbortController | null = null;
let activeLease: ServiceScheduleMonitorLease | null = null;

export interface ServiceScheduleMonitorCycleResult {
  instanceId: string;
  lease: Pick<ServiceScheduleMonitorLease, "key" | "holderInstanceId" | "generation"> | null;
  queuedOccurrences: number;
  skippedOccurrences: number;
  recoveredRuns: number;
  processedRuns: number;
  leaseLost: boolean;
}

export interface ServiceScheduleMonitorRuntimeStatus {
  instanceId: string;
  running: boolean;
  cycleInProgress: boolean;
  activeLease: Pick<ServiceScheduleMonitorLease, "key" | "holderInstanceId" | "generation"> | null;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  lastError: string | null;
  lastResult: ServiceScheduleMonitorCycleResult | null;
}

const runtimeStatus: ServiceScheduleMonitorRuntimeStatus = {
  instanceId: monitorInstanceId,
  running: false,
  cycleInProgress: false,
  activeLease: null,
  lastCycleStartedAt: null,
  lastCycleFinishedAt: null,
  lastError: null,
  lastResult: null
};

export interface RunServiceScheduleMonitorCycleOptions {
  instanceId?: string;
  leaseDurationMs?: number;
  dueLimit?: number;
  runLimit?: number;
  runConcurrency?: number;
  signal?: AbortSignal;
}

function resolveMonitorInstanceId() {
  const configured = process.env.DAOFLOW_SERVICE_SCHEDULE_MONITOR_INSTANCE_ID?.trim();
  if (configured) {
    if (configured.length > 32) {
      throw new Error(
        "DAOFLOW_SERVICE_SCHEDULE_MONITOR_INSTANCE_ID must be at most 32 characters."
      );
    }
    return configured;
  }
  return `ssm-${newId().slice(0, 28)}`;
}

function leaseReference(
  lease: ServiceScheduleMonitorLease
): Pick<ServiceScheduleMonitorLease, "key" | "holderInstanceId" | "generation"> {
  return {
    key: lease.key,
    holderInstanceId: lease.holderInstanceId,
    generation: lease.generation
  };
}

function setActiveLease(lease: ServiceScheduleMonitorLease | null) {
  activeLease = lease;
  runtimeStatus.activeLease = lease ? leaseReference(lease) : null;
}

function describeLeaseHeartbeatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Service schedule lease heartbeat failed.";
}

function startLeaseHeartbeat(lease: ServiceScheduleMonitorLease, leaseDurationMs: number) {
  return startServiceScheduleLeaseHeartbeat({
    lease,
    leaseDurationMs,
    onRenewed: (renewed) => setActiveLease(renewed),
    onLost: (error) => {
      setActiveLease(null);
      if (error) {
        runtimeStatus.lastError = describeLeaseHeartbeatError(error);
      }
    }
  });
}

function scheduleActor() {
  return {
    requestedByUserId: "service-schedule-runner",
    requestedByEmail: "service-schedule-runner@daoflow.local",
    requestedByRole: "operator" as const,
    actorType: "system" as const
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    if (signal.aborted) done();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function resolveServiceScheduleMonitorPollIntervalMs(
  rawValue = process.env.DAOFLOW_SERVICE_SCHEDULE_MONITOR_POLL_INTERVAL_MS
): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed >= MIN_POLL_INTERVAL_MS
    ? parsed
    : DEFAULT_POLL_INTERVAL_MS;
}

export function getServiceScheduleMonitorInstanceId(): string {
  return monitorInstanceId;
}

export function getServiceScheduleMonitorRuntimeStatus(): ServiceScheduleMonitorRuntimeStatus {
  return {
    ...runtimeStatus,
    activeLease: runtimeStatus.activeLease ? { ...runtimeStatus.activeLease } : null,
    lastResult: runtimeStatus.lastResult
      ? {
          ...runtimeStatus.lastResult,
          lease: runtimeStatus.lastResult.lease ? { ...runtimeStatus.lastResult.lease } : null
        }
      : null
  };
}

/**
 * Runs one lease-fenced monitor cycle. This is exported so tests and future
 * worker orchestration can exercise the durable behavior without starting a loop.
 */
export async function runServiceScheduleMonitorCycle(
  options: RunServiceScheduleMonitorCycleOptions = {}
): Promise<ServiceScheduleMonitorCycleResult> {
  const instanceId = options.instanceId ?? monitorInstanceId;
  runtimeStatus.cycleInProgress = true;
  runtimeStatus.lastCycleStartedAt = new Date().toISOString();
  runtimeStatus.lastError = null;
  const leaseDurationMs = options.leaseDurationMs ?? getServiceScheduleMonitorLeaseDurationMs();
  let heartbeat: ReturnType<typeof startServiceScheduleLeaseHeartbeat> | null = null;

  try {
    const lease = await acquireServiceScheduleMonitorLease({
      key: SERVICE_SCHEDULE_MONITOR_LEASE_KEY,
      holderInstanceId: instanceId,
      leaseDurationMs
    });
    if (!lease) {
      setActiveLease(null);
      const result: ServiceScheduleMonitorCycleResult = {
        instanceId,
        lease: null,
        queuedOccurrences: 0,
        skippedOccurrences: 0,
        recoveredRuns: 0,
        processedRuns: 0,
        leaseLost: false
      };
      runtimeStatus.lastResult = result;
      return result;
    }

    setActiveLease(lease);
    heartbeat = startLeaseHeartbeat(lease, leaseDurationMs);
    if (options.signal?.aborted) {
      await heartbeat.stop();
      heartbeat = null;
      await releaseServiceScheduleMonitorLease(lease);
      setActiveLease(null);
      const result: ServiceScheduleMonitorCycleResult = {
        instanceId,
        lease: leaseReference(lease),
        queuedOccurrences: 0,
        skippedOccurrences: 0,
        recoveredRuns: 0,
        processedRuns: 0,
        leaseLost: true
      };
      runtimeStatus.lastResult = result;
      return result;
    }

    const commandAbortController = new AbortController();
    const abortCommands = () => commandAbortController.abort();
    void heartbeat.waitForLoss().then(abortCommands);
    options.signal?.addEventListener("abort", abortCommands, { once: true });

    let recoveredRuns = 0;
    let created: Awaited<ReturnType<typeof createDueServiceScheduleRuns>> = [];
    let leaseStillCurrent = false;
    let runner = { processed: 0, leaseLost: true };
    try {
      recoveredRuns = await recoverStaleServiceScheduleRuns({
        actor: scheduleActor(),
        lease: heartbeat.currentLease()
      });
      created = await createDueServiceScheduleRuns({
        actor: scheduleActor(),
        lease: heartbeat.currentLease(),
        limit: options.dueLimit
      });
      leaseStillCurrent =
        !heartbeat.lostLease() &&
        (await isCurrentServiceScheduleMonitorLease(heartbeat.currentLease()));
      runner =
        !options.signal?.aborted && leaseStillCurrent
          ? await pollServiceScheduleRuns({
              lease: heartbeat.currentLease(),
              limit: options.runLimit,
              concurrency: options.runConcurrency,
              signal: commandAbortController.signal
            })
          : { processed: 0, leaseLost: !leaseStillCurrent };
    } finally {
      options.signal?.removeEventListener("abort", abortCommands);
    }
    const queuedOccurrences = created.filter((run) => run.status === "queued").length;
    const skippedOccurrences = created.filter((run) => run.status === "skipped").length;
    const heartbeatKeptLease = await heartbeat.stop();
    heartbeat = null;
    const finalLeaseCurrent =
      heartbeatKeptLease && (await isCurrentServiceScheduleMonitorLease(lease));
    const result: ServiceScheduleMonitorCycleResult = {
      instanceId,
      lease: leaseReference(lease),
      queuedOccurrences,
      skippedOccurrences,
      recoveredRuns,
      processedRuns: runner.processed,
      leaseLost: !leaseStillCurrent || runner.leaseLost || !finalLeaseCurrent
    };
    if (result.leaseLost) {
      setActiveLease(null);
    }
    runtimeStatus.lastResult = result;
    return result;
  } catch (error) {
    runtimeStatus.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await heartbeat?.stop();
    runtimeStatus.cycleInProgress = false;
    runtimeStatus.lastCycleFinishedAt = new Date().toISOString();
  }
}

async function runPollingLoop(input: { signal: AbortSignal; pollIntervalMs: number }) {
  const leaseDurationMs = getServiceScheduleMonitorLeaseDurationMs();
  while (!input.signal.aborted) {
    try {
      const result = await runServiceScheduleMonitorCycle({
        signal: input.signal,
        leaseDurationMs
      });
      if (result.processedRuns > 0) {
        console.log(`[service-schedules] Processed ${result.processedRuns} queued run(s).`);
      }
    } catch (error) {
      console.error(
        "[service-schedules] Poll cycle failed:",
        error instanceof Error ? error.message : String(error)
      );
    }

    if (!input.signal.aborted && activeLease) {
      const heartbeat = startLeaseHeartbeat(activeLease, leaseDurationMs);
      await Promise.race([sleep(input.pollIntervalMs, input.signal), heartbeat.waitForLoss()]);
      if (!(await heartbeat.stop())) setActiveLease(null);
    } else if (!input.signal.aborted) {
      await sleep(input.pollIntervalMs, input.signal);
    }
  }
}

export function startServiceScheduleMonitor(input: { pollIntervalMs?: number } = {}): void {
  if (monitorLoop) {
    console.warn("[service-schedules] Monitor already running, skipping duplicate start");
    return;
  }

  const controller = new AbortController();
  monitorAbortController = controller;
  runtimeStatus.running = true;
  const pollIntervalMs = input.pollIntervalMs ?? resolveServiceScheduleMonitorPollIntervalMs();
  console.log(`[service-schedules] Monitor started (poll interval: ${pollIntervalMs}ms)`);
  const loop = runPollingLoop({ signal: controller.signal, pollIntervalMs }).finally(() => {
    if (monitorLoop === loop) {
      monitorLoop = null;
      monitorAbortController = null;
      runtimeStatus.running = false;
      runtimeStatus.cycleInProgress = false;
    }
  });
  monitorLoop = loop;
}

export async function stopServiceScheduleMonitor(): Promise<void> {
  monitorAbortController?.abort();
  await monitorLoop;
  const lease = activeLease;
  if (lease) {
    await releaseServiceScheduleMonitorLease(lease).catch((error) => {
      console.error(
        "[service-schedules] Failed to release monitor lease:",
        error instanceof Error ? error.message : String(error)
      );
    });
  }
  setActiveLease(null);
}
