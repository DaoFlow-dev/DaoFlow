import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, MemoryStick, Network, HardDrive, Activity, Clock, RefreshCw } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";

interface MonitoringTabProps {
  serviceId: string;
  serviceName: string;
}

interface ContainerStats {
  cpuPercent: number;
  memoryUsageMB: number;
  memoryLimitMB: number;
  memoryPercent: number;
  networkRxMB: number;
  networkTxMB: number;
  blockReadMB: number;
  blockWriteMB: number;
  pids: number;
  uptime: string;
  restartCount: number;
}

interface TimeSeries {
  time: string;
  value: number;
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/container-stats/${serviceId}`);
      if (response.ok) {
        const data = (await response.json()) as ContainerStats;
        setStats(data);

        const now = new Date().toLocaleTimeString();
        setCpuHistory((prev) => [...prev.slice(-60), { time: now, value: data.cpuPercent }]);
        setMemHistory((prev) => [...prev.slice(-60), { time: now, value: data.memoryPercent }]);
        setNetRxHistory((prev) => [...prev.slice(-60), { time: now, value: data.networkRxMB }]);
        setNetTxHistory((prev) => [...prev.slice(-60), { time: now, value: data.networkTxMB }]);
      }
    } catch {
      // Container may not be running
    }
  }, [serviceId]);

  useEffect(() => {
    if (isPolling) {
      void fetchStats();
      intervalRef.current = setInterval(() => void fetchStats(), 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStats, isPolling]);

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard
          icon={<Cpu size={14} />}
          title="CPU"
          value={stats ? `${stats.cpuPercent.toFixed(1)}%` : "—"}
          color={stats && stats.cpuPercent > 80 ? "text-red-400" : undefined}
        />
        <StatsCard
          icon={<MemoryStick size={14} />}
          title="Memory"
          value={
            stats ? `${stats.memoryUsageMB.toFixed(0)} / ${stats.memoryLimitMB.toFixed(0)} MB` : "—"
          }
          subtitle={stats ? `${stats.memoryPercent.toFixed(1)}%` : undefined}
          color={stats && stats.memoryPercent > 85 ? "text-red-400" : undefined}
        />
        <StatsCard
          icon={<Network size={14} />}
          title="Network I/O"
          value={
            stats
              ? `↓ ${stats.networkRxMB.toFixed(1)} MB / ↑ ${stats.networkTxMB.toFixed(1)} MB`
              : "—"
          }
        />
        <StatsCard
          icon={<HardDrive size={14} />}
          title="Block I/O"
          value={
            stats
              ? `R ${stats.blockReadMB.toFixed(1)} MB / W ${stats.blockWriteMB.toFixed(1)} MB`
              : "—"
          }
        />
      </div>

      {/* Uptime / Restart / PIDs cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard icon={<Clock size={14} />} title="Uptime" value={stats?.uptime ?? "—"} />
        <StatsCard
          icon={<RefreshCw size={14} />}
          title="Restart Count"
          value={stats?.restartCount?.toString() ?? "0"}
        />
        <StatsCard
          icon={<Activity size={14} />}
          title="Processes"
          value={stats?.pids?.toString() ?? "—"}
        />
      </div>

      {/* CPU Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu size={14} />
              CPU Usage %
            </CardTitle>
            <Badge
              variant={isPolling ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setIsPolling(!isPolling)}
            >
              {isPolling ? "Live" : "Paused"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <MiniChart data={cpuHistory} color="#3b82f6" maxY={100} unit="%" />
        </CardContent>
      </Card>

      {/* Memory Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <MemoryStick size={14} />
            Memory Usage %
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MiniChart data={memHistory} color="#8b5cf6" maxY={100} unit="%" />
        </CardContent>
      </Card>

      {/* Network Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Network size={14} />
            Network I/O (MB)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Receive (↓)</p>
              <MiniChart data={netRxHistory} color="#22c55e" unit=" MB" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Transmit (↑)</p>
              <MiniChart data={netTxHistory} color="#f59e0b" unit=" MB" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatsCard({
  icon,
  title,
  value,
  subtitle,
  color
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          {icon}
          {title}
        </div>
        <span className={`text-lg font-semibold ${color ?? ""}`}>{value}</span>
        {subtitle && (
          <span className={`ml-2 text-sm ${color ?? "text-muted-foreground"}`}>{subtitle}</span>
        )}
      </CardContent>
    </Card>
  );
}

function MiniChart({
  data,
  color,
  maxY,
  unit = ""
}: {
  data: TimeSeries[];
  color: string;
  maxY?: number;
  unit?: string;
}) {
  if (data.length < 2) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
        Collecting data...
      </div>
    );
  }

  const actualMax = maxY ?? Math.max(...data.map((d) => d.value), 1);
  const width = 100;
  const height = 32;

  // Build SVG path
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (d.value / actualMax) * height;
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  const lastValue = data[data.length - 1]?.value ?? 0;

  return (
    <div className="relative">
      <div className="absolute top-0 right-0 text-xs font-mono text-muted-foreground">
        {lastValue.toFixed(1)}
        {unit}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#grad-${color})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
