import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Settings2,
  Globe,
  Server,
  Box,
  Activity,
  Clock,
  Rocket,
  RefreshCw,
  Square,
  Play
} from "lucide-react";

interface GeneralTabProps {
  service: {
    id: string;
    name: string;
    slug: string;
    sourceType: string;
    status: string;
    imageReference: string | null;
    dockerfilePath: string | null;
    composeServiceName: string | null;
    port: string | null;
    healthcheckPath: string | null;
    replicaCount: string;
    targetServerId: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

/* ── helpers ── */

function statusColor(status: string) {
  if (status === "active" || status === "healthy" || status === "running") return "bg-emerald-500";
  if (status === "failed" || status === "error") return "bg-red-500";
  if (status === "deploying" || status === "building") return "bg-amber-500 animate-pulse";
  return "bg-zinc-400";
}

function statusVariant(status: string): "default" | "destructive" | "secondary" {
  if (status === "active" || status === "healthy" || status === "running") return "default";
  if (status === "failed" || status === "error") return "destructive";
  return "secondary";
}

/* ── component ── */

export default function GeneralTab({ service }: GeneralTabProps) {
  const isRunning =
    service.status === "active" || service.status === "healthy" || service.status === "running";

  return (
    <div className="space-y-6">
      {/* Deploy Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Deploy Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="gap-1.5">
              <Rocket size={14} /> Deploy
            </Button>
            <Button size="sm" variant="secondary" className="gap-1.5">
              <RefreshCw size={14} /> Rebuild
            </Button>
            {isRunning ? (
              <Button size="sm" variant="destructive" className="gap-1.5">
                <Square size={14} /> Stop
              </Button>
            ) : (
              <Button size="sm" variant="secondary" className="gap-1.5">
                <Play size={14} /> Start
              </Button>
            )}

            {/* Autodeploy toggle */}
            <div className="flex items-center gap-2 ml-auto rounded-md border px-3 py-1.5">
              <span className="text-sm font-medium">Auto-deploy</span>
              <Switch aria-label="Toggle auto-deploy" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Activity size={14} />
              Status
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor(service.status)}`}
              />
              <Badge variant={statusVariant(service.status)} className="text-sm">
                {service.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Box size={14} />
              Source
            </div>
            <span className="text-lg font-semibold">{service.sourceType}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Server size={14} />
              Replicas
            </div>
            <span className="text-lg font-semibold">{service.replicaCount}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock size={14} />
              Created
            </div>
            <span className="text-sm">{new Date(service.createdAt).toLocaleDateString()}</span>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings2 size={14} />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <ConfigItem label="Service Name" value={service.name} />
            <ConfigItem label="Slug" value={service.slug} mono />
            <ConfigItem label="Source Type" value={service.sourceType} />
            {service.imageReference && (
              <ConfigItem label="Image" value={service.imageReference} mono />
            )}
            {service.dockerfilePath && (
              <ConfigItem label="Dockerfile" value={service.dockerfilePath} mono />
            )}
            {service.composeServiceName && (
              <ConfigItem label="Compose Service" value={service.composeServiceName} mono />
            )}
            {service.port && <ConfigItem label="Port" value={service.port} />}
            {service.healthcheckPath && (
              <ConfigItem label="Health Check" value={service.healthcheckPath} mono />
            )}
            <ConfigItem label="Updated" value={new Date(service.updatedAt).toLocaleString()} />
          </dl>
        </CardContent>
      </Card>

      {/* Network Info */}
      {service.port && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe size={14} />
              Networking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <ConfigItem label="Exposed Port" value={service.port} />
              {service.healthcheckPath && (
                <ConfigItem label="Health Endpoint" value={service.healthcheckPath} mono />
              )}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ConfigItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs mt-0.5" : "font-medium mt-0.5"}>{value}</dd>
    </div>
  );
}
