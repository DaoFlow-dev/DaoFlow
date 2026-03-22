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
import { getBadgeVariantFromTone, getToneDotClass } from "@/lib/tone-utils";

function formatRelative(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface GeneralTabProps {
  service: {
    id: string;
    name: string;
    slug: string;
    sourceType: string;
    status: string;
    statusTone?: string;
    statusLabel?: string;
    imageReference: string | null;
    dockerfilePath: string | null;
    composeServiceName: string | null;
    port: string | null;
    healthcheckPath: string | null;
    replicaCount: string;
    targetServerId: string | null;
    createdAt: string;
    updatedAt: string;
    runtimeSummary?: {
      statusLabel: string;
      statusTone: string;
      summary: string;
      observedAt: string | null;
    };
    rolloutStrategy?: {
      label: string;
      summary: string;
      downtimeRisk: string;
      supportsZeroDowntime: boolean;
    };
    latestDeployment?: {
      targetServerName: string | null;
      imageTag: string | null;
      finishedAt: string | null;
    } | null;
  };
}

export default function GeneralTab({ service }: GeneralTabProps) {
  const serviceTone = service.runtimeSummary?.statusTone ?? service.statusTone ?? service.status;
  const serviceLabel = service.runtimeSummary?.statusLabel ?? service.statusLabel ?? service.status;
  const isRunning = serviceTone === "healthy" || serviceTone === "running";

  return (
    <div className="space-y-6">
      {/* Deploy Actions */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Deploy Settings</CardTitle>
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
        <Card className="border-border/50 shadow-sm transition-all duration-200 hover:shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Activity size={14} />
              Status
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${getToneDotClass(serviceTone, {
                  pulse: serviceTone === "running"
                })}`}
              />
              <Badge variant={getBadgeVariantFromTone(serviceTone)} className="text-sm">
                {serviceLabel}
              </Badge>
            </div>
            {service.runtimeSummary ? (
              <p className="mt-2 text-xs text-muted-foreground">{service.runtimeSummary.summary}</p>
            ) : null}
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-sm transition-all duration-200 hover:shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Box size={14} />
              Source
            </div>
            <span className="text-lg font-semibold">{service.sourceType}</span>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-sm transition-all duration-200 hover:shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Server size={14} />
              Rollout
            </div>
            <span className="text-lg font-semibold">
              {service.rolloutStrategy?.label ?? service.replicaCount}
            </span>
            {service.rolloutStrategy ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                Downtime risk: {service.rolloutStrategy.downtimeRisk}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-sm transition-all duration-200 hover:shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock size={14} />
              Last Deployed
            </div>
            <span className="text-sm font-semibold">
              {formatRelative(service.latestDeployment?.finishedAt ?? service.updatedAt)}
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {new Date(service.createdAt).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Card */}
      <Card className="shadow-sm">
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
              <ConfigItem label="Legacy Health Metadata" value={service.healthcheckPath} mono />
            )}
            {service.latestDeployment?.targetServerName && (
              <ConfigItem label="Target Server" value={service.latestDeployment.targetServerName} />
            )}
            {service.latestDeployment?.imageTag && (
              <ConfigItem label="Current Image" value={service.latestDeployment.imageTag} mono />
            )}
            <ConfigItem label="Updated" value={new Date(service.updatedAt).toLocaleString()} />
          </dl>
        </CardContent>
      </Card>

      {/* Network Info */}
      {service.port && (
        <Card className="shadow-sm">
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
                <ConfigItem label="Legacy Health Metadata" value={service.healthcheckPath} mono />
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
