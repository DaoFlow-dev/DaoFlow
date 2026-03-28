import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";
import { Copy, ExternalLink, Globe2, Link2Off } from "lucide-react";
import type { ServiceEndpointSummary } from "./service-endpoint-types";

interface ServiceLinksCardProps {
  serviceId: string;
  endpointSummary: ServiceEndpointSummary;
}

export function ServiceLinksCard({ serviceId, endpointSummary }: ServiceLinksCardProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedId) {
      return;
    }

    const timeout = window.setTimeout(() => setCopiedId(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedId]);

  function handleCopy(linkId: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => setCopiedId(linkId));
  }

  function handleOpen(href: string) {
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <Card className="shadow-sm" data-testid={`service-links-card-${serviceId}`}>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe2 size={14} />
          Links and endpoints
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={getBadgeVariantFromTone(endpointSummary.statusTone)}
            data-testid={`service-links-status-${serviceId}`}
          >
            {endpointSummary.statusLabel}
          </Badge>
          <p
            className="text-sm text-muted-foreground"
            data-testid={`service-links-summary-${serviceId}`}
          >
            {endpointSummary.summary}
          </p>
        </div>

        {endpointSummary.links.length > 0 ? (
          <div className="space-y-3">
            {endpointSummary.links.map((link) => (
              <article
                key={link.id}
                className="rounded-xl border border-border/60 bg-muted/10 p-4"
                data-testid={`service-link-row-${serviceId}-${link.id}`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{link.label}</p>
                      {link.isCanonical ? (
                        <Badge
                          variant="outline"
                          data-testid={`service-link-canonical-${serviceId}-${link.id}`}
                        >
                          Canonical
                        </Badge>
                      ) : null}
                      <Badge
                        variant={getBadgeVariantFromTone(link.statusTone)}
                        data-testid={`service-link-status-${serviceId}-${link.id}`}
                      >
                        {link.statusLabel}
                      </Badge>
                    </div>
                    <p
                      className="break-all font-mono text-xs text-foreground"
                      data-testid={`service-link-value-${serviceId}-${link.id}`}
                    >
                      {link.copyValue}
                    </p>
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid={`service-link-summary-${serviceId}-${link.id}`}
                    >
                      {link.summary}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {link.href ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpen(link.href!)}
                        data-testid={`service-link-open-${serviceId}-${link.id}`}
                      >
                        <ExternalLink size={14} className="mr-1" />
                        Open
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(link.id, link.copyValue)}
                      data-testid={`service-link-copy-${serviceId}-${link.id}`}
                    >
                      <Copy size={14} className="mr-1" />
                      {copiedId === link.id ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div
            className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground"
            data-testid={`service-links-empty-${serviceId}`}
          >
            <div className="flex items-center gap-2 text-foreground">
              <Link2Off size={14} />
              No public link yet
            </div>
            <p className="mt-2">{endpointSummary.summary}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
