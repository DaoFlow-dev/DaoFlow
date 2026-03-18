import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings2, Globe, Server, Box, Activity, Clock } from "lucide-react";

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

export default function GeneralTab({ service }: GeneralTabProps) {
  return (
    <div className="space-y-6">
      {/* Status Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Activity size={14} />
              Status
            </div>
            <Badge
              variant={
                service.status === "active" || service.status === "healthy"
                  ? "default"
                  : "secondary"
              }
              className="text-sm"
            >
              {service.status}
            </Badge>
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
