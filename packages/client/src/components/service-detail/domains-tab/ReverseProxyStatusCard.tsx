import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";
import type { ServiceDomainSummary } from "./types";

export function ReverseProxyStatusCard({
  serviceId,
  summary
}: {
  serviceId: string;
  summary: ServiceDomainSummary;
}) {
  return (
    <Card className="shadow-sm" data-testid={`service-proxy-summary-${serviceId}`}>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield size={14} />
          Reverse Proxy Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p
          className="text-sm text-muted-foreground"
          data-testid={`service-proxy-copy-${serviceId}`}
        >
          DaoFlow compares desired hostnames against observed tunnel routes and separately tracks
          domains that are opted into managed Traefik routing.
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            count={summary.matchedDomainCount}
            label="Matched"
            className="border-emerald-500/40 text-emerald-600"
            testId={`service-proxy-matched-${serviceId}`}
          />
          <StatusBadge
            count={summary.missingDomainCount}
            label="Missing"
            className="border-amber-500/40 text-amber-600"
            testId={`service-proxy-missing-${serviceId}`}
          />
          <StatusBadge
            count={summary.inactiveDomainCount}
            label="Inactive"
            className="border-slate-400/40 text-slate-600"
            testId={`service-proxy-inactive-${serviceId}`}
          />
          <StatusBadge
            count={summary.conflictDomainCount}
            label="Conflict"
            className="border-red-500/40 text-red-600"
            testId={`service-proxy-conflict-${serviceId}`}
          />
        </div>
        <div
          className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground"
          data-testid={`service-proxy-next-step-${serviceId}`}
        >
          Managed Traefik routes are applied during Compose deployments when the target server has a
          managed proxy configured. Unmanaged domains continue to rely on external tunnel or proxy
          observation.
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            count={summary.managedDomainCount}
            label="Managed"
            className="border-cyan-500/40 text-cyan-600"
            testId={`service-proxy-managed-${serviceId}`}
          />
          <StatusBadge
            count={summary.plannedManagedRouteCount}
            label="Planned"
            className="border-emerald-500/40 text-emerald-600"
            testId={`service-proxy-planned-${serviceId}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  count,
  label,
  className,
  testId
}: {
  count: number;
  label: string;
  className: string;
  testId: string;
}) {
  return (
    <Badge variant="outline" className={`text-xs ${className}`} data-testid={testId}>
      {label} {count}
    </Badge>
  );
}
