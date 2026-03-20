import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Wrench } from "lucide-react";
import { ResourceLimitsCard } from "./ResourceLimitsCard";
import { RestartPolicyCard } from "./RestartPolicyCard";
import { HealthCheckCard } from "./HealthCheckCard";
import { VolumesCard } from "./VolumesCard";
import { NetworksCard } from "./NetworksCard";
import { getRuntimeConfigSupportReason, type ServiceRuntimeConfig } from "./runtime-config";

interface AdvancedTabProps {
  serviceId: string;
  service: {
    sourceType: string;
    composeServiceName: string | null;
    healthcheckPath?: string | null;
    port?: string | null;
  };
  runtimeConfig: ServiceRuntimeConfig | null;
  onConfigSaved: () => Promise<unknown>;
}

export default function AdvancedTab({
  serviceId,
  service,
  runtimeConfig,
  onConfigSaved
}: AdvancedTabProps) {
  const supportReason = getRuntimeConfigSupportReason(service);

  if (supportReason) {
    return (
      <Card className="shadow-sm" data-testid="service-runtime-config-unsupported">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench size={14} />
            Runtime Overrides
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">{supportReason}</p>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Direct source compose editing is not available here. Configure the upstream compose
              source directly until DaoFlow can safely render a scoped override for this service.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">DaoFlow-Managed Override Layer</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="service-runtime-config-hint">
            These cards store DaoFlow-managed compose overrides. Empty values inherit from the
            source compose files, and saved overrides are merged into the rendered compose stack on
            the next deployment.
          </p>
        </CardContent>
      </Card>
      <ResourceLimitsCard
        serviceId={serviceId}
        resources={runtimeConfig?.resources ?? null}
        onSaved={onConfigSaved}
      />
      <RestartPolicyCard
        serviceId={serviceId}
        restartPolicy={runtimeConfig?.restartPolicy ?? null}
        onSaved={onConfigSaved}
      />
      <HealthCheckCard
        serviceId={serviceId}
        healthcheckPath={service.healthcheckPath ?? null}
        port={service.port ?? null}
        healthCheck={runtimeConfig?.healthCheck ?? null}
        onSaved={onConfigSaved}
      />
      <VolumesCard
        serviceId={serviceId}
        volumes={runtimeConfig?.volumes ?? []}
        onSaved={onConfigSaved}
      />
      <NetworksCard
        serviceId={serviceId}
        networks={runtimeConfig?.networks ?? []}
        onSaved={onConfigSaved}
      />
    </div>
  );
}
