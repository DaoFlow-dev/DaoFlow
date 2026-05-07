import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { AlertTriangle, Clock, KeyRound, RefreshCw, ShieldAlert } from "lucide-react";

const statusOptions = [
  "all",
  "failed-auth",
  "denied",
  "error",
  "slow",
  "webhook",
  "api-token"
] as const;
type StatusFilter = (typeof statusOptions)[number];

type AccessLogEntry = {
  id: string;
  requestId: string;
  method: string;
  path: string;
  category: string;
  statusCode: number;
  outcome: string;
  durationMs: number;
  actorEmail: string | null;
  actorId: string | null;
  actorType: string | null;
  tokenName: string | null;
  tokenPrefix: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  errorCategory: string | null;
  requiredScopes: string[];
  grantedScopes: string[];
  createdAt: string;
};

function statusVariant(statusCode: number) {
  if (statusCode >= 500) return "destructive" as const;
  if (statusCode >= 400) return "secondary" as const;
  return "default" as const;
}

function actorLabel(entry: AccessLogEntry) {
  return entry.actorEmail ?? entry.tokenName ?? entry.actorId ?? "anonymous";
}

export default function AccessLogsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryInput = useMemo(
    () => ({
      limit: 50,
      cursor: cursor ?? undefined,
      status: status === "all" ? undefined : status,
      search: search.trim() || undefined
    }),
    [cursor, search, status]
  );
  const accessLogs = trpc.accessLogs.useQuery(queryInput);
  const entries = (accessLogs.data?.entries ?? []) as AccessLogEntry[];
  const summary = accessLogs.data?.summary;

  return (
    <main className="shell space-y-6" data-testid="access-logs-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground">
            Recent API access, auth failures, webhook calls, and token usage.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void accessLogs.refetch()}
          data-testid="access-logs-refresh"
        >
          <RefreshCw size={14} className="mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4" data-testid="access-logs-summary">
        <Card data-testid="access-logs-summary-total">
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-mono text-xl font-semibold">{summary?.totalEntries ?? 0}</p>
              <p className="text-xs text-muted-foreground">Total requests</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="access-logs-summary-failed-auth">
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-mono text-xl font-semibold">{summary?.failedAuth ?? 0}</p>
              <p className="text-xs text-muted-foreground">Failed auth</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="access-logs-summary-token">
          <CardContent className="flex items-center gap-3 p-4">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-mono text-xl font-semibold">{summary?.apiTokenRequests ?? 0}</p>
              <p className="text-xs text-muted-foreground">API token</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="access-logs-summary-slow">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="font-mono text-xl font-semibold">{summary?.slowRequests ?? 0}</p>
              <p className="text-xs text-muted-foreground">Slow requests</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <CardTitle className="text-base">Request Log</CardTitle>
          <div className="flex flex-col gap-3 md:flex-row">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setCursor(null);
              }}
              placeholder="Search request id, path, actor, or token"
              data-testid="access-logs-search"
            />
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as StatusFilter);
                setCursor(null);
              }}
            >
              <SelectTrigger className="md:w-[190px]" data-testid="access-logs-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "all" ? "All requests" : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {accessLogs.isLoading ? (
            <div className="space-y-2" data-testid="access-logs-loading">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : accessLogs.isError ? (
            <div
              className="py-10 text-center text-sm text-destructive"
              data-testid="access-logs-error"
            >
              Unable to load request logs.
            </div>
          ) : entries.length === 0 ? (
            <div
              className="py-10 text-center text-sm text-muted-foreground"
              data-testid="access-logs-empty"
            >
              No request logs matched.
            </div>
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const expanded = expandedId === entry.id;
                    return (
                      <TableRow
                        key={entry.id}
                        className="cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : entry.id)}
                        data-testid={`access-log-row-${entry.id}`}
                      >
                        <TableCell data-testid={`access-log-time-${entry.id}`}>
                          {new Date(entry.createdAt).toLocaleString()}
                          {expanded ? (
                            <pre
                              className="mt-3 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-muted-foreground"
                              data-testid={`access-log-details-${entry.id}`}
                            >
                              {[
                                `requestId: ${entry.requestId}`,
                                `category: ${entry.category}`,
                                `error: ${entry.errorCategory ?? "none"}`,
                                `token: ${entry.tokenName ?? "none"} ${entry.tokenPrefix ?? ""}`.trim(),
                                `requiredScopes: ${entry.requiredScopes.join(", ") || "none"}`,
                                `grantedScopes: ${entry.grantedScopes.join(", ") || "none"}`,
                                `userAgent: ${entry.userAgent ?? "unknown"}`
                              ].join("\n")}
                            </pre>
                          ) : null}
                        </TableCell>
                        <TableCell
                          className="font-mono text-xs"
                          data-testid={`access-log-path-${entry.id}`}
                        >
                          {entry.method} {entry.path}
                        </TableCell>
                        <TableCell data-testid={`access-log-status-${entry.id}`}>
                          <Badge variant={statusVariant(entry.statusCode)}>
                            {entry.statusCode}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`access-log-duration-${entry.id}`}>
                          {entry.durationMs}ms
                        </TableCell>
                        <TableCell data-testid={`access-log-actor-${entry.id}`}>
                          {actorLabel(entry)}
                        </TableCell>
                        <TableCell data-testid={`access-log-source-${entry.id}`}>
                          {entry.sourceIp ?? "unknown"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span data-testid="access-logs-retention">
                  Retention: {accessLogs.data?.retentionDays ?? 30} days
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!accessLogs.data?.nextCursor}
                  onClick={() => setCursor(accessLogs.data?.nextCursor ?? null)}
                  data-testid="access-logs-next-page"
                >
                  Next page
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
