import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  formatAge,
  formatGb,
  formatPercent,
  type MetricPolicy,
  type MetricSample
} from "./ServerMetricsPanelModel";
const policyFields = [
  ["sampleIntervalSeconds", "Sample interval", "seconds", true],
  ["retentionDays", "Retention", "days", true],
  ["cpuWarnPercent", "CPU warning", "%", true],
  ["cpuHardPercent", "CPU hard", "%", true],
  ["memoryWarnPercent", "Memory warning", "%", true],
  ["memoryHardPercent", "Memory hard", "%", true],
  ["diskWarnPercent", "Root disk warning", "%", true],
  ["diskHardPercent", "Root disk hard", "%", true],
  ["dockerDiskWarnPercent", "Docker disk warning", "%", true],
  ["dockerDiskHardPercent", "Docker disk hard", "%", true],
  ["cooldownMinutes", "Alert cooldown", "minutes", true]
] as const;
const historyColumns = [
  { label: "CPU", key: "cpuPercent", testKey: "cpu" },
  { label: "Memory", key: "memoryUsedPercent", testKey: "memory" },
  { label: "Root disk", key: "diskUsedPercent", testKey: "disk" },
  { label: "Docker disk", key: "dockerDiskUsedPercent", testKey: "docker-disk" }
] as const;
function policyToDraft(policy: MetricPolicy) {
  return Object.fromEntries(policyFields.map(([key]) => [key, String(policy[key])])) as Record<
    string,
    string
  >;
}
export function LatestMetricsGrid({
  serverId,
  latest
}: {
  serverId: string;
  latest: MetricSample | null;
}) {
  const tiles = [
    { metric: "cpu", label: "CPU", value: formatPercent(latest?.cpuPercent) },
    {
      metric: "memory",
      label: "Memory",
      value: formatPercent(latest?.memoryUsedPercent),
      detail: latest
        ? `${formatGb(latest.memoryUsedGB)} / ${formatGb(latest.memoryTotalGB)}`
        : undefined
    },
    {
      metric: "disk",
      label: "Root disk",
      value: formatPercent(latest?.diskUsedPercent),
      detail: latest ? `${formatGb(latest.diskTotalGB)} total` : undefined
    },
    {
      metric: "docker-disk",
      label: "Docker disk",
      value: formatPercent(latest?.dockerDiskUsedPercent),
      detail: latest ? `${formatGb(latest.dockerDiskTotalGB)} total` : undefined
    }
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Latest server metrics">
      {tiles.map((tile) => (
        <div
          className="rounded-lg border border-border/60 p-3"
          data-testid={`server-metrics-latest-${tile.metric}-${serverId}`}
          key={tile.metric}
        >
          <dt className="text-xs font-medium text-muted-foreground">{tile.label}</dt>
          <dd
            className="mt-1 text-lg font-semibold"
            data-testid={`server-metrics-latest-${tile.metric}-value-${serverId}`}
          >
            {tile.value}
          </dd>
          {tile.detail ? (
            <dd
              className="text-xs text-muted-foreground"
              data-testid={`server-metrics-latest-${tile.metric}-detail-${serverId}`}
            >
              {tile.detail}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
export function MetricsHistoryTable({
  serverId,
  history
}: {
  serverId: string;
  history: MetricSample[];
}) {
  return history.length === 0 ? (
    <p
      className="text-sm text-muted-foreground"
      data-testid={`server-metrics-history-empty-${serverId}`}
    >
      No samples have been collected yet.
    </p>
  ) : (
    <Table aria-label="Recent server metric history">
      <caption className="sr-only">Recent server metric samples</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Collected</TableHead>
          <TableHead>Age</TableHead>
          {historyColumns.map((column) => (
            <TableHead key={column.key}>{column.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map((sample) => (
          <TableRow key={sample.id} data-testid={`server-metrics-history-row-${sample.id}`}>
            <TableCell data-testid={`server-metrics-history-collected-${sample.id}`}>
              {new Date(sample.collectedAt).toLocaleString()}
            </TableCell>
            <TableCell data-testid={`server-metrics-history-age-${sample.id}`}>
              {formatAge(sample.collectedAt)}
            </TableCell>
            {historyColumns.map((column) => (
              <TableCell
                key={column.key}
                data-testid={`server-metrics-history-${column.testKey}-${sample.id}`}
              >
                {formatPercent(sample[column.key])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export function MetricsPolicyForm({
  serverId,
  policy,
  canManage,
  isPending,
  onSave
}: {
  serverId: string;
  policy: MetricPolicy;
  canManage: boolean;
  isPending: boolean;
  onSave: (policy: MetricPolicy) => Promise<MetricPolicy>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => policyToDraft(policy));
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  useEffect(() => setDraft(policyToDraft(policy)), [policy]);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setFeedback(null);
    try {
      const values = Object.fromEntries(
        policyFields.map(([key, label, , integer]) => {
          const value = Number(draft[key]);
          const minimum = key.endsWith("Percent") || key === "cooldownMinutes" ? 0 : 1;
          if (!draft[key].trim() || !Number.isFinite(value) || value < minimum) {
            throw new Error(`${label} must be a valid non-negative value.`);
          }
          if (integer && !Number.isInteger(value)) {
            throw new Error(`${label} must be a whole number.`);
          }
          return [key, value];
        })
      ) as MetricPolicy;

      const updatedPolicy = await onSave(values);
      setDraft(policyToDraft(updatedPolicy));
      setFeedback({ message: "Metrics policy saved.", error: false });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Unable to save the metrics policy.",
        error: true
      });
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Monitoring policy</CardTitle>
        <CardDescription>Sampling and alert thresholds for this server.</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className="mb-4 rounded-md bg-muted p-3 text-sm text-muted-foreground"
          data-testid={`server-metrics-zero-help-${serverId}`}
        >
          A threshold set to 0 disables that threshold. Policy changes only affect monitoring and
          alerts; they never trigger automatic remediation.
        </p>
        <form className="flex flex-col gap-5" onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="sr-only">Server metrics policy</legend>
            {policyFields.map((field) => (
              <div className="flex flex-col gap-2" key={field[0]}>
                <Label htmlFor={`server-metrics-policy-${field[0]}-${serverId}`}>
                  {field[1]} ({field[2]})
                </Label>
                <Input
                  id={`server-metrics-policy-${field[0]}-${serverId}`}
                  type="number"
                  min={field[0].endsWith("Percent") || field[0] === "cooldownMinutes" ? 0 : 1}
                  step={field[3] ? 1 : "any"}
                  value={draft[field[0]]}
                  readOnly={!canManage}
                  aria-readonly={!canManage}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field[0]]: event.target.value }))
                  }
                  data-testid={`server-metrics-policy-${field[0]}-${serverId}`}
                />
              </div>
            ))}
          </fieldset>
          {!canManage ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid={`server-metrics-read-only-${serverId}`}
            >
              Only owners and admins with server:write can change this policy.
            </p>
          ) : (
            <Button
              type="submit"
              disabled={isPending}
              data-testid={`server-metrics-save-${serverId}`}
            >
              <Save data-icon="inline-start" /> {isPending ? "Saving…" : "Save policy"}
            </Button>
          )}
          {feedback ? (
            <p
              className={
                feedback.error
                  ? "text-sm text-destructive"
                  : "text-sm text-emerald-700 dark:text-emerald-400"
              }
              role={feedback.error ? "alert" : "status"}
              aria-live="polite"
              data-testid={`server-metrics-feedback-${serverId}`}
            >
              {feedback.message}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
