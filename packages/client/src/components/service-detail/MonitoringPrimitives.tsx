import { Card, CardContent } from "@/components/ui/card";

export interface TimeSeries {
  time: string;
  value: number;
}

export function MonitoringStatsCard({
  icon,
  title,
  value,
  subtitle,
  color,
  testId
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
  testId: string;
}) {
  return (
    <Card
      className="border-border/50 shadow-sm transition-all duration-200 hover:shadow-md"
      data-testid={testId}
    >
      <CardContent className="pt-6">
        <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
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

export function MonitoringMiniChart({
  data,
  color,
  maxY,
  unit = "",
  testId
}: {
  data: TimeSeries[];
  color: string;
  maxY?: number;
  unit?: string;
  testId: string;
}) {
  if (data.length < 2) {
    return (
      <div
        className="flex h-32 items-center justify-center text-sm text-muted-foreground"
        data-testid={testId}
      >
        Collecting data...
      </div>
    );
  }

  const actualMax = maxY ?? Math.max(...data.map((d) => d.value), 1);
  const width = 100;
  const height = 32;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (d.value / actualMax) * height;
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const lastValue = data[data.length - 1]?.value ?? 0;

  return (
    <div className="relative" data-testid={testId}>
      <div className="absolute top-0 right-0 text-xs font-mono text-muted-foreground">
        {lastValue.toFixed(1)}
        {unit}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" preserveAspectRatio="none">
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
