import { useDeferredValue, useState } from "react";
import { trpc } from "../lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Terminal } from "lucide-react";

interface Props {
  deploymentId: string;
}

export default function DeploymentLogViewer({ deploymentId }: Props) {
  const [query, setQuery] = useState("");
  const [stream, setStream] = useState<"all" | "stdout" | "stderr">("all");
  const deferredQuery = useDeferredValue(query);
  const logs = trpc.deploymentLogs.useQuery(
    {
      deploymentId,
      query: deferredQuery.trim() || undefined,
      stream,
      limit: 100
    },
    { refetchInterval: 5000 }
  );

  if (logs.isLoading) {
    return (
      <div className="space-y-1 p-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  const entries = (logs.data?.lines as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={14}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search deployment logs..."
            className="h-8 pl-9 text-sm"
            data-testid={`deployment-logs-search-${deploymentId}`}
          />
        </div>
        <div className="flex items-center rounded-md border text-xs">
          {(["all", "stdout", "stderr"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              data-testid={`deployment-logs-stream-${deploymentId}-${candidate}`}
              onClick={() => setStream(candidate)}
              className={`px-2.5 py-1 transition-colors ${
                stream === candidate ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              } ${candidate === "all" ? "rounded-l-md" : candidate === "stderr" ? "rounded-r-md" : ""}`}
            >
              {candidate === "all" ? "All" : candidate}
            </button>
          ))}
        </div>
        <span
          className="text-xs text-muted-foreground"
          data-testid={`deployment-logs-count-${deploymentId}`}
        >
          {logs.data?.summary.totalLines ?? 0} match
          {(logs.data?.summary.totalLines ?? 0) === 1 ? "" : "es"}
          {logs.isFetching ? " · updating" : ""}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          <Terminal size={16} className="mx-auto mb-1 opacity-40" />
          {query || stream !== "all"
            ? "No log lines match the current filters."
            : "No logs available for this deployment."}
        </div>
      ) : (
        <div
          role="log"
          aria-live="polite"
          className="bg-zinc-950 text-zinc-200 border border-zinc-800 dark:bg-black/90 rounded-md p-3 max-h-72 overflow-y-auto font-mono text-xs leading-relaxed"
        >
          {entries.map((entry, i) => {
            const level = typeof entry.level === "string" ? entry.level : "info";
            const message =
              typeof entry.message === "string"
                ? entry.message
                : typeof entry.detail === "string"
                  ? entry.detail
                  : "";
            const timestampValue =
              typeof entry.createdAt === "string" || typeof entry.createdAt === "number"
                ? entry.createdAt
                : typeof entry.timestamp === "string" || typeof entry.timestamp === "number"
                  ? entry.timestamp
                  : null;
            const timestamp = timestampValue ? new Date(timestampValue).toLocaleTimeString() : "";

            return (
              <div key={i} className="flex gap-2 hover:bg-muted/50 px-1 py-0.5">
                {timestamp && <span className="text-muted-foreground shrink-0">{timestamp}</span>}
                <Badge
                  variant={
                    level === "error" ? "destructive" : level === "warn" ? "secondary" : "outline"
                  }
                  className="h-4 text-[10px] shrink-0"
                >
                  {level}
                </Badge>
                <span
                  className={
                    level === "error"
                      ? "text-red-600 dark:text-red-400"
                      : level === "warn"
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-foreground/80"
                  }
                >
                  {message}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
