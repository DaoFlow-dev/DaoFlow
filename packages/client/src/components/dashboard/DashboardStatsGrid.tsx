import type { ComponentType, CSSProperties } from "react";
import { CardContent } from "@/components/ui/card";

export interface DashboardStat {
  label: string;
  value: number;
  icon: ComponentType<{ size?: number; className?: string }>;
  color: string;
  bg: string;
  href: string;
}

function hoverGradient(color: string) {
  if (color.includes("blue")) return "rgba(59,130,246,0.04)";
  if (color.includes("purple")) return "rgba(168,85,247,0.04)";
  if (color.includes("amber")) return "rgba(245,158,11,0.04)";
  return "rgba(16,185,129,0.04)";
}

export function DashboardStatsGrid({
  stats,
  onOpen
}: {
  stats: DashboardStat[];
  onOpen: (href: string) => void;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 xl:gap-5"
      data-testid="dashboard-stats-grid"
    >
      {stats.map((stat, index) => (
        <button
          type="button"
          key={stat.label}
          data-testid={`dashboard-stat-${stat.label.toLowerCase()}`}
          className="stagger-item card-hover-glow group relative overflow-hidden rounded-xl border border-transparent bg-gradient-to-br from-card to-card/80 text-left text-card-foreground shadow-sm hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ "--stagger-delay": `${index * 60}ms` } as CSSProperties}
          onClick={() => onOpen(stat.href)}
        >
          <div
            className="absolute inset-0 bg-gradient-to-br from-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              backgroundImage: `linear-gradient(135deg, transparent 60%, ${hoverGradient(
                stat.color
              )})`
            }}
          />
          <CardContent className="relative flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${stat.bg} transition-transform duration-300 group-hover:scale-110`}
            >
              <stat.icon size={20} className={stat.color} />
            </div>
            <div>
              <p className="font-mono text-2xl font-bold tracking-tight">{stat.value}</p>
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
            </div>
          </CardContent>
        </button>
      ))}
    </div>
  );
}
