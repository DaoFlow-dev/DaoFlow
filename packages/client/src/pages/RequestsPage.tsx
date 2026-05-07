import { useState } from "react";
import { Activity, KeyRound, Radio, ShieldAlert, TimerReset } from "lucide-react";
import { trpc } from "../lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

const filters = [
  { key: "all", label: "All", icon: Activity },
  { key: "failed-auth", label: "Failed Auth", icon: ShieldAlert },
  { key: "api-token", label: "API Tokens", icon: KeyRound },
  { key: "webhooks", label: "Webhooks", icon: Radio },
  { key: "slow", label: "Slow", icon: TimerReset }
] as const;

type FilterKey = (typeof filters)[number]["key"];

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function badgeVariant(outcome: string) {
  if (outcome === "success") return "default" as const;
  if (outcome === "denied") return "secondary" as const;
  return "destructive" as const;
}

export default function RequestsPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const logs = trpc.requestAccessLogs.useQuery({
    limit: 50,
    failedAuth: filter === "failed-auth" ? true : undefined,
    apiTokenOnly: filter === "api-token" ? true : undefined,
    webhooksOnly: filter === "webhooks" ? true : undefined,
    slowMs: filter === "slow" ? 1000 : undefined
  });
  const summary = logs.data?.summary;
  const entries = logs.data?.entries ?? [];

  return (
    <main className="shell space-y-6" data-testid="requests-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground">
            Recent access records, token use, and denied requests.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void logs.refetch()}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-5" data-testid="request-summary-grid">
        {[
          ["Total", summary?.totalRequests ?? 0],
          ["Failed", summary?.failedRequests ?? 0],
          ["Denied", summary?.deniedRequests ?? 0],
          ["Tokens", summary?.apiTokenRequests ?? 0],
          ["Webhooks", summary?.webhookRequests ?? 0]
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div>
            <CardTitle className="text-base">Access Log</CardTitle>
            <CardDescription>
              Durable request records retained by the control plane.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <Button
                key={item.key}
                size="sm"
                variant={filter === item.key ? "default" : "outline"}
                onClick={() => setFilter(item.key)}
              >
                <item.icon className="mr-1.5 h-4 w-4" />
                {item.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {logs.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No request records match this view.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTime(entry.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {entry.method} {entry.path}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {entry.requestId} · {entry.category} · {entry.durationMs}ms
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeVariant(entry.outcome)}>
                          {entry.statusCode} {entry.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.actorLabel}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.tokenLabel ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.sourceIp ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
