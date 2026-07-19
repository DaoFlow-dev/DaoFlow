import {
  renewServiceScheduleMonitorLease,
  type ServiceScheduleMonitorLease
} from "../db/services/service-schedule-lease";

type LeaseHeartbeatLease = Pick<
  ServiceScheduleMonitorLease,
  "key" | "holderInstanceId" | "generation"
>;

export interface ServiceScheduleLeaseHeartbeat {
  currentLease(): ServiceScheduleMonitorLease;
  lostLease(): boolean;
  waitForLoss(): Promise<void>;
  stop(): Promise<boolean>;
}

export function startServiceScheduleLeaseHeartbeat(input: {
  lease: ServiceScheduleMonitorLease;
  leaseDurationMs: number;
  onRenewed?: (lease: ServiceScheduleMonitorLease) => void;
  onLost?: (error?: unknown) => void;
  renewLease?: typeof renewServiceScheduleMonitorLease;
}): ServiceScheduleLeaseHeartbeat {
  const intervalMs = Math.max(25, Math.floor(input.leaseDurationMs / 3));
  const renewLease = input.renewLease ?? renewServiceScheduleMonitorLease;
  let currentLease = input.lease;
  let stopped = false;
  let leaseLost = false;
  let renewal: Promise<void> | null = null;
  let resolveLoss!: () => void;
  const loss = new Promise<void>((resolve) => {
    resolveLoss = resolve;
  });

  const markLost = (error?: unknown) => {
    if (leaseLost) return;
    leaseLost = true;
    resolveLoss();
    input.onLost?.(error);
  };

  const renew = () => {
    if (stopped || leaseLost || renewal) return;
    const lease: LeaseHeartbeatLease = currentLease;
    renewal = renewLease({ lease, leaseDurationMs: input.leaseDurationMs })
      .then((renewed) => {
        if (!renewed) {
          markLost();
          return;
        }
        currentLease = renewed;
        input.onRenewed?.(renewed);
      })
      .catch((error) => markLost(error))
      .finally(() => {
        renewal = null;
      });
  };

  const timer = setInterval(renew, intervalMs);

  return {
    currentLease: () => currentLease,
    lostLease: () => leaseLost,
    waitForLoss: () => loss,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await renewal;
      return !leaseLost;
    }
  };
}
