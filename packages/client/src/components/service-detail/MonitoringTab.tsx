import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Cpu, HardDrive, MemoryStick, Network, Power, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MonitoringMiniChart, MonitoringStatsCard, type TimeSeries } from "./MonitoringPrimitives";
import { readObservabilityJson, type ContainerStats } from "./observability-client";

interface MonitoringTabProps {
  serviceId: string;
  serviceName: string;
}

function appendSeriesPoint(prev: TimeSeries[], value: number): TimeSeries[] {
  const time = new Date().toLocaleTimeString();
  return [...prev.slice(-60), { time, value }];
}

export default function MonitoringTab({
  serviceId,
  serviceName: _serviceName
}: MonitoringTabProps) {
  const [stats, setStats] = useState<ContainerStats | null>(null);
  const [cpuHistory, setCpuHistory] = useState<TimeSeries[]>([]);
  const [memHistory, setMemHistory] = useState<TimeSeries[]>([]);
  const [netRxHistory, setNetRxHistory] = useState<TimeSeries[]>([]);
  const [netTxHistory, setNetTxHistory] = useState<TimeSeries[]>([]);
  const [isPolling, setIsPolling] = useState(true);
  const [historyMinutes, setHistoryMinutes] = useState(5);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    const result = await readObservabilityJson<ContainerStats>(
      `/api/v1/container-stats/${serviceId}`
    );
    setIsLoading(false);

    if (!result.ok) {
      if (result.error.code === "NOT_RUNNING") {
        setStats(null);
        setStatusMessage("Container not running");
        setIsPolling(false);
        return;
      }

      setStatusMessage(result.error.message);
      return;
    }

    setStatusMessage(null);
    setStats(result.data);
    setCpuHistory((prev) => appendSeriesPoint(prev, result.data.cpuPercent));
    setMemHistory((prev) => appendSeriesPoint(prev, result.data.memoryPercent));
    setNetRxHistory((prev) => appendSeriesPoint(prev, result.data.networkRxMB));
    setNetTxHistory((prev) => appendSeriesPoint(prev, result.data.networkTxMB));
  }, [serviceId]);

  useEffect(() => {
    if (!isPolling) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setIsLoading(true);
    void fetchStats();
    intervalRef.current = setInterval(() => void fetchStats(), 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchStats, isPolling]);

  const maxPoints = historyMinutes * 12;
  const trimmedCpu = cpuHistory.slice(-maxPoints);
  const trimmedMem = memHistory.slice(-maxPoints);
  const trimmedNetRx = netRxHistory.slice(-maxPoints);
  const trimmedNetTx = netTxHistory.slice(-maxPoints);

  if (!stats && statusMessage === "Container not running") {
    return (
      <Card className="shadow-sm" data-testid={`monitoring-card-${serviceId}`}>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
            <Power size={24} className="text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium" data-testid={`monitoring-status-${serviceId}`}>
              Container not running
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start the service to see real-time metrics.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid={`monitoring-retry-${serviceId}`}
            onClick={() => {
              setStatusMessage(null);
              setIsPolling(true);
            }}
          >
            <RefreshCw size={14} className="mr-1" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid={`monitoring-panel-${serviceId}`}>
      {statusMessage && statusMessage !== "Container not running" && (
        <Alert variant="destructive" data-testid={`monitoring-alert-${serviceId}`}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <MonitoringStatsCard
          icon={<Cpu size={14} />}
          title="CPU"
          value={stats ? `${stats.cpuPercent.toFixed(1)}%` : "—"}
          color={stats && stats.cpuPercent > 80 ? "text-red-400" : undefined}
          testId={`monitoring-cpu-${serviceId}`}
        />
        <MonitoringStatsCard
          icon={<MemoryStick size={14} />}
          title="Memory"
          value={
            stats ? `${stats.memoryUsageMB.toFixed(0)} / ${stats.memoryLimitMB.toFixed(0)} MB` : "—"
          }
          subtitle={stats ? `${stats.memoryPercent.toFixed(1)}%` : undefined}
          color={stats && stats.memoryPercent > 85 ? "text-red-400" : undefined}
          testId={`monitoring-memory-${serviceId}`}
        />
        <MonitoringStatsCard
          icon={<Network size={14} />}
          title="Network I/O"
          value={
            stats
              ? `↓ ${stats.networkRxMB.toFixed(1)} MB / ↑ ${stats.networkTxMB.toFixed(1)} MB`
              : "—"
          }
          testId={`monitoring-network-${serviceId}`}
        />
        <MonitoringStatsCard
          icon={<HardDrive size={14} />}
          title="Block I/O"
          value={
            stats
              ? `R ${stats.blockReadMB.toFixed(1)} MB / W ${stats.blockWriteMB.toFixed(1)} MB`
              : "—"
          }
          testId={`monitoring-block-${serviceId}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MonitoringStatsCard
          icon={<Power size={14} />}
          title="Uptime"
          value={stats?.uptime ?? "—"}
          testId={`monitoring-uptime-${serviceId}`}
        />
        <MonitoringStatsCard
          icon={<RefreshCw size={14} />}
          title="Restart Count"
          value={stats?.restartCount?.toString() ?? "0"}
          testId={`monitoring-restarts-${serviceId}`}
        />
        <MonitoringStatsCard
          icon={<Cpu size={14} />}
          title="Processes"
          value={stats?.pids?.toString() ?? "—"}
          testId={`monitoring-pids-${serviceId}`}
        />
      </div>

      <Card className="shadow-sm" data-testid={`monitoring-chart-cpu-card-${serviceId}`}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cpu size={14} />
              CPU Usage %
            </CardTitle>
            <div className="ml-auto flex items-center rounded-md border text-xs">
              {([1, 5, 30] as const).map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  data-testid={`monitoring-range-${serviceId}-${minutes}m`}
                  onClick={() => setHistoryMinutes(minutes)}
                  className={`px-2 py-1 transition-colors ${
                    historyMinutes === minutes
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  } ${minutes === 1 ? "rounded-l-md" : minutes === 30 ? "rounded-r-md" : ""}`}
                >
                  {minutes}m
                </button>
              ))}
            </div>
            <Badge
              variant={isPolling ? "default" : "secondary"}
              className="cursor-pointer"
              data-testid={`monitoring-live-${serviceId}`}
              onClick={() => setIsPolling((value) => !value)}
            >
              {isPolling ? "Live" : "Paused"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <MonitoringMiniChart
            data={trimmedCpu}
            color="#3b82f6"
            maxY={100}
            unit="%"
            testId={`monitoring-chart-cpu-${serviceId}`}
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm" data-testid={`monitoring-chart-memory-card-${serviceId}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <MemoryStick size={14} />
            Memory Usage %
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MonitoringMiniChart
            data={trimmedMem}
            color="#8b5cf6"
            maxY={100}
            unit="%"
            testId={`monitoring-chart-memory-${serviceId}`}
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm" data-testid={`monitoring-chart-network-card-${serviceId}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Network size={14} />
            Network I/O (MB)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Receive (↓)</p>
              <MonitoringMiniChart
                data={trimmedNetRx}
                color="#22c55e"
                unit=" MB"
                testId={`monitoring-chart-network-rx-${serviceId}`}
              />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Transmit (↑)</p>
              <MonitoringMiniChart
                data={trimmedNetTx}
                color="#f59e0b"
                unit=" MB"
                testId={`monitoring-chart-network-tx-${serviceId}`}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && !stats && !statusMessage && (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`monitoring-loading-${serviceId}`}
        >
          Loading live container metrics...
        </p>
      )}
    </div>
  );
}
