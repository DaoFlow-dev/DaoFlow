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
          DaoFlow persists desired hostnames and compares them against observed tunnel or
          reverse-proxy routes. This tab does not provision Traefik or Caddy rules on its own.
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
          Use tunnel routes or your external reverse proxy to point each hostname at the published
          service entrypoint, then return here to confirm DaoFlow sees the route as matched and
          TLS-ready.
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
