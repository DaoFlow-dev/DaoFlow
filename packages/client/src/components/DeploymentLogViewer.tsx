import { trpc } from "../lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Terminal } from "lucide-react";

interface Props {
  deploymentId: string;
}

export default function DeploymentLogViewer({ deploymentId }: Props) {
  const logs = trpc.deploymentLogs.useQuery(
    { deploymentId, limit: 100 },
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

  if (entries.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        <Terminal size={16} className="mx-auto mb-1 opacity-40" />
        No logs available for this deployment.
      </div>
    );
  }

  return (
    <div className="bg-black/90 rounded-md p-3 max-h-72 overflow-y-auto font-mono text-xs leading-relaxed">
      {entries.map((entry, i) => {
        const level =
          typeof entry.level === "string" ? entry.level : "info";
        const message =
          typeof entry.message === "string"
            ? entry.message
            : typeof entry.detail === "string"
              ? entry.detail
              : "";
        const timestamp =
          typeof entry.timestamp === "string" || typeof entry.timestamp === "number"
            ? new Date(entry.timestamp).toLocaleTimeString()
            : "";

        return (
          <div key={i} className="flex gap-2 hover:bg-white/5 px-1 py-0.5">
            {timestamp && <span className="text-gray-500 shrink-0">{timestamp}</span>}
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
                  ? "text-red-400"
                  : level === "warn"
                    ? "text-yellow-400"
                    : "text-gray-300"
              }
            >
              {message}
            </span>
          </div>
        );
      })}
    </div>
  );
}
