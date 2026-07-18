import { HardDrive, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ResourceResult, ServerOperation } from "./server-operation-types";

export function ResourcesPanel({
  serverId,
  resource,
  isPending,
  onRefresh
}: {
  serverId: string;
  resource: ResourceResult | null;
  isPending: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card data-testid={`server-resources-${serverId}`}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Host Resources</CardTitle>
        <Button size="sm" onClick={onRefresh} disabled={isPending}>
          {isPending ? "Checking..." : "Check Now"}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="CPU load" value={formatPercent(resource?.cpu?.loadPercent)} />
        <Metric label="Memory used" value={formatPercent(resource?.memory?.usedPercent)} />
        <Metric label="Disk used" value={formatPercent(resource?.disk?.usedPercent)} />
        <Metric label="Docker" value={resource?.docker?.reachable ? "reachable" : "unknown"} />
      </CardContent>
    </Card>
  );
}

export function CleanupPanel(props: {
  canRun: boolean;
  includeVolumes: boolean;
  onIncludeVolumesChange: (value: boolean) => void;
  hasPreview: boolean;
  isPending: boolean;
  onPreview: () => void;
  onRun: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench size={15} />
          Host Cleanup
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={props.includeVolumes} onCheckedChange={props.onIncludeVolumesChange} />
          Include unused Docker volumes
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={props.onPreview} disabled={!props.canRun || props.isPending}>
            Preview Cleanup
          </Button>
          <Button
            variant="destructive"
            onClick={props.onRun}
            disabled={!props.canRun || !props.hasPreview || props.isPending}
          >
            Run Cleanup
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PatchingPanel(props: {
  canRun: boolean;
  isPending: boolean;
  latestPlan?: ServerOperation;
  onPlan: () => void;
}) {
  const result = props.latestPlan?.result as
    | { summary?: string; packageCount?: number }
    | undefined;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive size={15} />
          Patch Plan
        </CardTitle>
        <Button size="sm" onClick={props.onPlan} disabled={!props.canRun || props.isPending}>
          {props.isPending ? "Planning..." : "Queue Plan"}
        </Button>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {result?.summary ?? "No patch plan recorded yet."}
        {typeof result?.packageCount === "number" ? ` ${result.packageCount} packages.` : ""}
      </CardContent>
    </Card>
  );
}

export function HistoryPanel(props: {
  operations: ServerOperation[];
  selectedOperation?: ServerOperation;
  logs: Array<{ id: number; stream: string; message: string; createdAt: string }>;
  onSelect: (operationId: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operation History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {props.operations.map((operation) => (
            <button
              key={operation.id}
              className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted"
              onClick={() => props.onSelect(operation.id)}
              data-testid={`server-operation-${operation.id}`}
            >
              <span className="font-medium">{operation.kind.replace(/_/g, " ")}</span>
              <span className="ml-2 text-muted-foreground">{operation.status}</span>
              <p className="mt-1 text-xs text-muted-foreground">{operation.summary}</p>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Logs {props.selectedOperation ? `· ${props.selectedOperation.kind}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
            {props.logs.length > 0
              ? props.logs.map((log) => `[${log.stream}] ${log.message}`).join("\n")
              : "Select an operation."}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(0)}%` : "unknown";
}
