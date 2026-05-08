import { memo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ServerReadinessIndicator } from "@/components/ServerReadinessIndicator";
import { SwarmTopologySummary } from "@/components/SwarmTopologySummary";
import type { SwarmTopologySnapshot } from "@daoflow/shared";

export interface ServerCheck {
  serverId: unknown;
  serverName: unknown;
  serverHost: unknown;
  targetKind: unknown;
  swarmTopology: SwarmTopologySnapshot | null;
  sshPort: unknown;
  readinessStatus: unknown;
  sshReachable: boolean;
  dockerReachable: boolean;
  composeReachable: boolean;
  checkedAt: string;
  latencyMs: number | null;
  issues: string[];
  recommendedActions: string[];
  cpuPercent?: number | null;
  memPercent?: number | null;
  diskPercent?: number | null;
}

interface ServerCheckCardProps {
  check: ServerCheck;
  onOpen?: (serverId: string) => void;
}

export const ServerCheckCard = memo(function ServerCheckCard({
  check,
  onOpen
}: ServerCheckCardProps) {
  const serverId = String(check.serverId);
  return (
    <Card className="border-border/50 shadow-sm transition-all duration-200 hover:shadow-md">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{String(check.serverName)}</CardTitle>
            <CardDescription>
              {String(check.serverHost)} · {String(check.targetKind)} · SSH {String(check.sshPort)}
            </CardDescription>
          </div>
          <ServerReadinessIndicator
            readinessStatus={String(check.readinessStatus)}
            dataTestId={`server-status-${String(check.serverId)}`}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <CapabilityBadge
            ok={true}
            label={`Target ${String(check.targetKind)}`}
            dataTestId={`server-target-kind-${String(check.serverId)}`}
          />
          {String(check.targetKind) === "docker-swarm-manager" ? (
            <CapabilityBadge
              ok={true}
              label="Stack deploy + rollback"
              dataTestId={`server-swarm-capability-${String(check.serverId)}`}
            />
          ) : null}
          <CapabilityBadge
            ok={check.sshReachable}
            label={`SSH ${check.sshReachable ? "reachable" : "blocked"}`}
          />
          <CapabilityBadge
            ok={check.dockerReachable}
            label={`Docker ${check.dockerReachable ? "reachable" : "blocked"}`}
          />
          <CapabilityBadge
            ok={check.composeReachable}
            label={`Compose ${check.composeReachable ? "reachable" : "blocked"}`}
          />
        </div>

        <div className="text-sm text-muted-foreground">
          Checked {new Date(String(check.checkedAt)).toLocaleString()}
          {check.latencyMs !== null ? ` · ${check.latencyMs} ms` : ""}
        </div>

        {check.swarmTopology ? (
          <SwarmTopologySummary serverId={String(check.serverId)} topology={check.swarmTopology} />
        ) : null}

        <ResourceBars check={check} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">Issues</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {check.issues.length > 0 ? (
                check.issues.map((issue) => <li key={issue}>{issue}</li>)
              ) : (
                <li>No open issues.</li>
              )}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Recommended Actions</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {check.recommendedActions.length > 0 ? (
                check.recommendedActions.map((action) => <li key={action}>{action}</li>)
              ) : (
                <li>No action required.</li>
              )}
            </ul>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpen?.(serverId)}
          data-testid={`server-open-${serverId}`}
        >
          Operations
        </Button>
      </CardContent>
    </Card>
  );
});

ServerCheckCard.displayName = "ServerCheckCard";

export function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="border-border/50 shadow-sm transition-all duration-200 hover:shadow-md">
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

function CapabilityBadge({
  ok,
  label,
  dataTestId
}: {
  ok: boolean;
  label: string;
  dataTestId?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}
      data-testid={dataTestId}
    >
      {ok ? (
        <CheckCircle2 size={14} className="text-emerald-500" />
      ) : (
        <XCircle size={14} className="text-red-500" />
      )}
      <span className="font-medium">{label}</span>
    </div>
  );
}

function ResourceBars({ check }: { check: ServerCheck }) {
  const cpuPercent = typeof check.cpuPercent === "number" ? check.cpuPercent : null;
  const memPercent = typeof check.memPercent === "number" ? check.memPercent : null;
  const diskPercent = typeof check.diskPercent === "number" ? check.diskPercent : null;

  if (cpuPercent === null && memPercent === null && diskPercent === null) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {cpuPercent !== null && <UsageBar label="CPU" value={cpuPercent} />}
      {memPercent !== null && <UsageBar label="Memory" value={memPercent} />}
      {diskPercent !== null && <UsageBar label="Disk" value={diskPercent} />}
    </div>
  );
}

function UsageBar({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? "bg-red-500" : value >= 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">{value.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}
