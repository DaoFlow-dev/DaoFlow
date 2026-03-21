import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ExternalLink, Globe, Plus, Star, Trash2 } from "lucide-react";
import { renderTlsIcon, statusBadgeClass } from "./utils";
import type { ServiceDomainStateRecord, ServiceDomainSummary } from "./types";

interface CustomDomainsCardProps {
  serviceId: string;
  newDomain: string;
  domainMutating: boolean;
  summary: ServiceDomainSummary;
  domains: ServiceDomainStateRecord[];
  domainFeedback: string | null;
  onNewDomainChange: (value: string) => void;
  onAddDomain: () => void;
  onSetPrimary: (domain: ServiceDomainStateRecord) => void;
  onRemoveDomain: (domain: ServiceDomainStateRecord) => void;
}

export function CustomDomainsCard({
  serviceId,
  newDomain,
  domainMutating,
  summary,
  domains,
  domainFeedback,
  onNewDomainChange,
  onAddDomain,
  onSetPrimary,
  onRemoveDomain
}: CustomDomainsCardProps) {
  const needsAttention =
    summary.missingDomainCount + summary.inactiveDomainCount + summary.conflictDomainCount;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe size={14} />
          Custom Domains
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2">
          <Input
            placeholder="app.example.com"
            value={newDomain}
            onChange={(event) => onNewDomainChange(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onAddDomain()}
            className="h-8 text-sm flex-1"
            data-testid={`service-domain-input-${serviceId}`}
          />
          <Button
            size="sm"
            onClick={onAddDomain}
            disabled={!newDomain.trim() || domainMutating}
            data-testid={`service-domain-add-${serviceId}`}
          >
            <Plus size={14} className="mr-1" />
            Add
          </Button>
        </div>

        <div
          className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
          data-testid={`service-domain-summary-${serviceId}`}
        >
          <SummaryTile
            serviceId={serviceId}
            label="Primary domain"
            testIdSuffix="primary"
            value={summary.primaryDomain ?? "None"}
          />
          <SummaryTile
            serviceId={serviceId}
            label="Desired domains"
            testIdSuffix="count"
            value={summary.desiredDomainCount}
          />
          <SummaryTile
            serviceId={serviceId}
            label="Matched routes"
            testIdSuffix="matched"
            value={summary.matchedDomainCount}
          />
          <SummaryTile
            serviceId={serviceId}
            label="Needs attention"
            testIdSuffix="attention"
            value={needsAttention}
          />
        </div>

        {domains.length === 0 ? (
          <p
            className="text-sm text-muted-foreground py-4 text-center"
            data-testid={`service-domain-empty-${serviceId}`}
          >
            No custom domains are persisted for this service yet.
          </p>
        ) : (
          <div className="space-y-3">
            {domains.map((domain) => (
              <DomainRow
                key={domain.id}
                domain={domain}
                serviceId={serviceId}
                domainMutating={domainMutating}
                onSetPrimary={onSetPrimary}
                onRemoveDomain={onRemoveDomain}
              />
            ))}
          </div>
        )}

        {domainFeedback ? (
          <p
            className="mt-4 text-sm text-muted-foreground"
            data-testid={`service-domain-feedback-${serviceId}`}
          >
            {domainFeedback}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  serviceId,
  label,
  testIdSuffix,
  value
}: {
  serviceId: string;
  label: string;
  testIdSuffix: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className="font-medium text-sm"
        data-testid={`service-domain-summary-${testIdSuffix}-${serviceId}`}
      >
        {value}
      </div>
    </div>
  );
}

function DomainRow({
  domain,
  serviceId,
  domainMutating,
  onSetPrimary,
  onRemoveDomain
}: {
  domain: ServiceDomainStateRecord;
  serviceId: string;
  domainMutating: boolean;
  onSetPrimary: (domain: ServiceDomainStateRecord) => void;
  onRemoveDomain: (domain: ServiceDomainStateRecord) => void;
}) {
  return (
    <div
      className="rounded-lg border px-3 py-3"
      data-testid={`service-domain-row-${serviceId}-${domain.id}`}
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {renderTlsIcon(domain.tlsStatus)}
            <span
              className="font-medium text-sm"
              data-testid={`service-domain-hostname-${serviceId}-${domain.id}`}
            >
              {domain.hostname}
            </span>
            {domain.isPrimary ? (
              <Badge
                variant="default"
                className="text-xs"
                data-testid={`service-domain-primary-${serviceId}-${domain.id}`}
              >
                Primary
              </Badge>
            ) : null}
            <Badge
              variant="outline"
              className={`text-xs ${statusBadgeClass(domain.proxyStatus)}`}
              data-testid={`service-domain-proxy-${serviceId}-${domain.id}`}
            >
              Proxy {domain.proxyStatus}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${statusBadgeClass(domain.tlsStatus)}`}
              data-testid={`service-domain-tls-${serviceId}-${domain.id}`}
            >
              TLS {domain.tlsStatus}
            </Badge>
          </div>

          <div
            className="text-xs text-muted-foreground"
            data-testid={`service-domain-observed-${serviceId}-${domain.id}`}
          >
            {domain.observedRoute ? (
              <>
                Observed via tunnel {domain.observedRoute.tunnelName} as service{" "}
                {domain.observedRoute.service}
                {domain.observedRoute.path ? ` on path ${domain.observedRoute.path}` : ""}. Route
                status: {domain.observedRoute.status}.
              </>
            ) : (
              "No matching tunnel or reverse-proxy route is currently observed."
            )}
            {" Added "}
            {new Date(domain.createdAt).toLocaleDateString()}.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!domain.isPrimary ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSetPrimary(domain)}
              disabled={domainMutating}
              data-testid={`service-domain-make-primary-${serviceId}-${domain.id}`}
            >
              <Star size={14} className="mr-1" />
              Set Primary
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(`https://${domain.hostname}`, "_blank")}
            aria-label={`Open ${domain.hostname}`}
            data-testid={`service-domain-open-${serviceId}-${domain.id}`}
          >
            <ExternalLink size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => onRemoveDomain(domain)}
            disabled={domainMutating}
            aria-label={`Remove ${domain.hostname}`}
            data-testid={`service-domain-remove-${serviceId}-${domain.id}`}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
