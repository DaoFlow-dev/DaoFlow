import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Rocket,
  RefreshCw,
  Settings2,
  Key,
  Shield,
  AlertTriangle,
  Clock,
  User
} from "lucide-react";

interface ActivityTabProps {
  serviceId: string;
}

function iconForAction(action: string) {
  if (action.includes("deploy")) return <Rocket size={14} className="text-blue-500" />;
  if (action.includes("restart") || action.includes("redeploy"))
    return <RefreshCw size={14} className="text-orange-500" />;
  if (action.includes("config") || action.includes("update"))
    return <Settings2 size={14} className="text-purple-500" />;
  if (action.includes("env") || action.includes("secret") || action.includes("variable"))
    return <Key size={14} className="text-yellow-500" />;
  if (action.includes("approval") || action.includes("permission"))
    return <Shield size={14} className="text-green-500" />;
  if (action.includes("error") || action.includes("fail"))
    return <AlertTriangle size={14} className="text-red-500" />;
  return <Activity size={14} className="text-muted-foreground" />;
}

export default function ActivityTab({ serviceId: _serviceId }: ActivityTabProps) {
  const audit = trpc.auditTrail.useQuery({ limit: 50 });
  const timeline = trpc.operationsTimeline.useQuery({ limit: 50 });

  // auditTrail returns { entries: [...], summary: {...} }
  const auditEntries = audit.data && "entries" in audit.data ? audit.data.entries : [];
  const timelineEntries = Array.isArray(timeline.data) ? timeline.data : [];

  const activities = [
    ...auditEntries.map(
      (a: {
        id: string;
        detail: string;
        actorLabel: string;
        resourceType: string;
        createdAt: string;
      }) => ({
        id: a.id,
        action: a.resourceType,
        actor: a.actorLabel,
        detail: a.detail,
        time: a.createdAt,
        source: "audit" as const
      })
    ),
    ...timelineEntries.map(
      (t: { id: number; kind: string; summary: string; createdAt: string }) => ({
        id: String(t.id),
        action: t.kind,
        actor: "system",
        detail: t.summary,
        time: t.createdAt,
        source: "timeline" as const
      })
    )
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  if (audit.isLoading || timeline.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity size={14} />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No recent activity recorded.
          </p>
        ) : (
          <div className="relative border-l border-border ml-3 pl-6 space-y-4">
            {activities.slice(0, 50).map((a) => (
              <div key={a.id} className="relative">
                {/* Timeline dot */}
                <div className="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-background border-2 border-border flex items-center justify-center">
                  {iconForAction(a.action)}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{a.action}</span>
                    <Badge variant="outline" className="text-xs">
                      {a.source}
                    </Badge>
                  </div>
                  {a.detail && <p className="text-sm text-muted-foreground mt-0.5">{a.detail}</p>}
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <Clock size={12} />
                    {new Date(a.time).toLocaleString()}
                    {a.actor && a.actor !== "system" && (
                      <span className="flex items-center gap-1">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                          {a.actor.charAt(0).toUpperCase()}
                        </span>
                        <span className="font-medium">{a.actor}</span>
                      </span>
                    )}
                    {a.actor === "system" && (
                      <span className="flex items-center gap-1">
                        <User size={12} className="text-muted-foreground" />
                        system
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
