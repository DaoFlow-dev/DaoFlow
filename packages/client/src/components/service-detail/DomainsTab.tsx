import { useEffect, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  Cable,
  ExternalLink,
  Globe,
  Plus,
  RotateCcw,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2
} from "lucide-react";

interface DomainsTabProps {
  serviceId: string;
  serviceName: string;
}

type DomainProxyStatus = "matched" | "missing" | "inactive" | "conflict";
type DomainTlsStatus = "ready" | "pending" | "inactive" | "conflict";
type ServicePortProtocol = "tcp" | "udp";

interface ServiceDomainStateRecord {
  id: string;
  hostname: string;
  isPrimary: boolean;
  createdAt: string;
  proxyStatus: DomainProxyStatus;
  tlsStatus: DomainTlsStatus;
  observedRoute: {
    hostname: string;
    service: string;
    path: string | null;
    status: string;
    tunnelId: string;
    tunnelName: string;
  } | null;
}

interface ServicePortMappingRecord {
  id: string;
  hostPort: number;
  containerPort: number;
  protocol: ServicePortProtocol;
  createdAt: string;
}

interface PortMappingDraft {
  draftId: string;
  id?: string;
  hostPort: string;
  containerPort: string;
  protocol: ServicePortProtocol;
}

function createDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function toPortDrafts(mappings: ServicePortMappingRecord[]): PortMappingDraft[] {
  return mappings.map((mapping) => ({
    draftId: mapping.id,
    id: mapping.id,
    hostPort: String(mapping.hostPort),
    containerPort: String(mapping.containerPort),
    protocol: mapping.protocol
  }));
}

function serializePortMappings(
  mappings: Array<Pick<PortMappingDraft, "id" | "hostPort" | "containerPort" | "protocol">>
) {
  return JSON.stringify(
    mappings.map((mapping) => ({
      id: mapping.id ?? null,
      hostPort: mapping.hostPort.trim(),
      containerPort: mapping.containerPort.trim(),
      protocol: mapping.protocol
    }))
  );
}

function formatMutationError(error: unknown, fallback: string) {
  return isTRPCClientError(error) ? error.message : fallback;
}

function parsePort(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}

function statusBadgeClass(status: DomainProxyStatus | DomainTlsStatus) {
  switch (status) {
    case "matched":
    case "ready":
      return "border-emerald-500/40 text-emerald-600";
    case "missing":
    case "pending":
      return "border-amber-500/40 text-amber-600";
    case "inactive":
      return "border-slate-400/40 text-slate-600";
    case "conflict":
      return "border-red-500/40 text-red-600";
  }
}

function tlsIcon(status: DomainTlsStatus) {
  switch (status) {
    case "ready":
      return <ShieldCheck size={14} className="text-emerald-600" />;
    case "conflict":
      return <ShieldAlert size={14} className="text-red-600" />;
    default:
      return <Shield size={14} className="text-muted-foreground" />;
  }
}

export default function DomainsTab({ serviceId, serviceName }: DomainsTabProps) {
  const utils = trpc.useUtils();
  const [newDomain, setNewDomain] = useState("");
  const [portDrafts, setPortDrafts] = useState<PortMappingDraft[]>([]);
  const [newHostPort, setNewHostPort] = useState("");
  const [newContainerPort, setNewContainerPort] = useState("");
  const [newProtocol, setNewProtocol] = useState<ServicePortProtocol>("tcp");
  const [domainFeedback, setDomainFeedback] = useState<string | null>(null);
  const [portFeedback, setPortFeedback] = useState<string | null>(null);
  const [isEditingPorts, setIsEditingPorts] = useState(false);

  const domainState = trpc.serviceDomainState.useQuery(
    { serviceId },
    { enabled: Boolean(serviceId) }
  );
  const addDomain = trpc.addServiceDomain.useMutation();
  const removeDomain = trpc.removeServiceDomain.useMutation();
  const setPrimaryDomain = trpc.setPrimaryServiceDomain.useMutation();
  const updatePortMappings = trpc.updateServicePortMappings.useMutation();

  useEffect(() => {
    if (!isEditingPorts) {
      setPortDrafts(toPortDrafts(domainState.data?.portMappings ?? []));
    }
  }, [domainState.data?.portMappings, isEditingPorts]);

  async function refreshOperationalViews() {
    await Promise.all([
      utils.serviceDomainState.invalidate({ serviceId }),
      utils.serviceDetails.invalidate({ serviceId })
    ]);
  }

  const baselinePorts = serializePortMappings(
    (domainState.data?.portMappings ?? []).map((mapping) => ({
      id: mapping.id,
      hostPort: String(mapping.hostPort),
      containerPort: String(mapping.containerPort),
      protocol: mapping.protocol
    }))
  );
  const currentPorts = serializePortMappings(portDrafts);
  const portsDirty = baselinePorts !== currentPorts;

  async function handleAddDomain() {
    if (!newDomain.trim()) {
      return;
    }

    setDomainFeedback(null);
    try {
      await addDomain.mutateAsync({
        serviceId,
        hostname: newDomain
      });
      setNewDomain("");
      setDomainFeedback("Saved domain configuration.");
      await refreshOperationalViews();
    } catch (error) {
      setDomainFeedback(formatMutationError(error, "Unable to save the domain right now."));
    }
  }

  async function handleRemoveDomain(domain: ServiceDomainStateRecord) {
    setDomainFeedback(null);
    try {
      await removeDomain.mutateAsync({
        serviceId,
        domainId: domain.id
      });
      setDomainFeedback(`Removed ${domain.hostname}.`);
      await refreshOperationalViews();
    } catch (error) {
      setDomainFeedback(formatMutationError(error, "Unable to remove the domain right now."));
    }
  }

  async function handleSetPrimary(domain: ServiceDomainStateRecord) {
    setDomainFeedback(null);
    try {
      await setPrimaryDomain.mutateAsync({
        serviceId,
        domainId: domain.id
      });
      setDomainFeedback(`${domain.hostname} is now the primary domain.`);
      await refreshOperationalViews();
    } catch (error) {
      setDomainFeedback(formatMutationError(error, "Unable to update the primary domain."));
    }
  }

  function handleAddPortDraft() {
    if (!newHostPort.trim() || !newContainerPort.trim()) {
      return;
    }

    setPortFeedback(null);
    setPortDrafts((current) => [
      ...current,
      {
        draftId: createDraftId(),
        hostPort: newHostPort.trim(),
        containerPort: newContainerPort.trim(),
        protocol: newProtocol
      }
    ]);
    setIsEditingPorts(true);
    setNewHostPort("");
    setNewContainerPort("");
    setNewProtocol("tcp");
  }

  function updateDraft(
    draftId: string,
    patch: Partial<Pick<PortMappingDraft, "hostPort" | "containerPort" | "protocol">>
  ) {
    setIsEditingPorts(true);
    setPortDrafts((current) =>
      current.map((draft) => (draft.draftId === draftId ? { ...draft, ...patch } : draft))
    );
  }

  function removeDraft(draftId: string) {
    setIsEditingPorts(true);
    setPortDrafts((current) => current.filter((draft) => draft.draftId !== draftId));
  }

  function resetPorts() {
    setPortDrafts(toPortDrafts(domainState.data?.portMappings ?? []));
    setIsEditingPorts(false);
    setNewHostPort("");
    setNewContainerPort("");
    setNewProtocol("tcp");
    setPortFeedback(null);
  }

  async function handleSavePorts() {
    const seenHostPorts = new Set<string>();
    const payload = [];

    for (const draft of portDrafts) {
      const hostPort = parsePort(draft.hostPort);
      const containerPort = parsePort(draft.containerPort);
      if (!hostPort || !containerPort) {
        setPortFeedback("Port mappings must use integer ports between 1 and 65535.");
        return;
      }

      const dedupeKey = `${hostPort}:${draft.protocol}`;
      if (seenHostPorts.has(dedupeKey)) {
        setPortFeedback(`Duplicate host port ${hostPort}/${draft.protocol} is not allowed.`);
        return;
      }
      seenHostPorts.add(dedupeKey);

      payload.push({
        id: draft.id,
        hostPort,
        containerPort,
        protocol: draft.protocol
      });
    }

    setPortFeedback(null);
    try {
      await updatePortMappings.mutateAsync({
        serviceId,
        portMappings: payload
      });
      setIsEditingPorts(false);
      setPortFeedback("Saved port mappings.");
      await refreshOperationalViews();
    } catch (error) {
      setPortFeedback(formatMutationError(error, "Unable to save port mappings right now."));
    }
  }

  if (domainState.isLoading) {
    return (
      <div className="space-y-4" data-testid={`service-domains-loading-${serviceId}`}>
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    );
  }

  if (domainState.error || !domainState.data) {
    return (
      <Card className="shadow-sm" data-testid={`service-domains-error-${serviceId}`}>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {formatMutationError(domainState.error, "Unable to load domain state.")}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            size="sm"
            onClick={() => void domainState.refetch()}
            data-testid={`service-domains-retry-${serviceId}`}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const domainMutating =
    addDomain.isPending || removeDomain.isPending || setPrimaryDomain.isPending;

  return (
    <div className="space-y-6" data-testid={`service-domains-tab-${serviceId}`}>
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
              onChange={(event) => setNewDomain(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void handleAddDomain()}
              className="h-8 text-sm flex-1"
              data-testid={`service-domain-input-${serviceId}`}
            />
            <Button
              size="sm"
              onClick={() => void handleAddDomain()}
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
            <div className="rounded-lg border px-3 py-2">
              <div className="text-xs text-muted-foreground">Primary domain</div>
              <div
                className="font-medium text-sm"
                data-testid={`service-domain-summary-primary-${serviceId}`}
              >
                {domainState.data.summary.primaryDomain ?? "None"}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <div className="text-xs text-muted-foreground">Desired domains</div>
              <div
                className="font-medium text-sm"
                data-testid={`service-domain-summary-count-${serviceId}`}
              >
                {domainState.data.summary.desiredDomainCount}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <div className="text-xs text-muted-foreground">Matched routes</div>
              <div
                className="font-medium text-sm"
                data-testid={`service-domain-summary-matched-${serviceId}`}
              >
                {domainState.data.summary.matchedDomainCount}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <div className="text-xs text-muted-foreground">Needs attention</div>
              <div
                className="font-medium text-sm"
                data-testid={`service-domain-summary-attention-${serviceId}`}
              >
                {domainState.data.summary.missingDomainCount +
                  domainState.data.summary.inactiveDomainCount +
                  domainState.data.summary.conflictDomainCount}
              </div>
            </div>
          </div>

          {domainState.data.domains.length === 0 ? (
            <p
              className="text-sm text-muted-foreground py-4 text-center"
              data-testid={`service-domain-empty-${serviceId}`}
            >
              No custom domains are persisted for this service yet.
            </p>
          ) : (
            <div className="space-y-3">
              {domainState.data.domains.map((domain) => (
                <div
                  key={domain.id}
                  className="rounded-lg border px-3 py-3"
                  data-testid={`service-domain-row-${serviceId}-${domain.id}`}
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {tlsIcon(domain.tlsStatus)}
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
                            {domain.observedRoute.path
                              ? ` on path ${domain.observedRoute.path}`
                              : ""}
                            . Route status: {domain.observedRoute.status}.
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
                          onClick={() => void handleSetPrimary(domain)}
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
                        onClick={() => void handleRemoveDomain(domain)}
                        disabled={domainMutating}
                        aria-label={`Remove ${domain.hostname}`}
                        data-testid={`service-domain-remove-${serviceId}-${domain.id}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
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

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Cable size={14} />
            Port Mappings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Persist explicit published ports for {serviceName}. Adjust rows inline, then save the
            desired published-port state.
          </p>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              type="number"
              placeholder="Host port"
              value={newHostPort}
              onChange={(event) => setNewHostPort(event.target.value)}
              className="h-8 w-28 text-sm"
              data-testid={`service-port-host-input-${serviceId}`}
            />
            <span className="text-muted-foreground">:</span>
            <Input
              type="number"
              placeholder="Container port"
              value={newContainerPort}
              onChange={(event) => setNewContainerPort(event.target.value)}
              className="h-8 w-32 text-sm"
              data-testid={`service-port-container-input-${serviceId}`}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNewProtocol((current) => (current === "tcp" ? "udp" : "tcp"))}
              data-testid={`service-port-protocol-toggle-${serviceId}`}
            >
              {newProtocol.toUpperCase()}
            </Button>
            <Button
              size="sm"
              onClick={handleAddPortDraft}
              disabled={!newHostPort.trim() || !newContainerPort.trim()}
              data-testid={`service-port-add-${serviceId}`}
            >
              <Plus size={14} className="mr-1" />
              Add
            </Button>
          </div>

          {portDrafts.length === 0 ? (
            <p
              className="text-sm text-muted-foreground py-4 text-center"
              data-testid={`service-port-empty-${serviceId}`}
            >
              No explicit DaoFlow-managed port mappings are saved.
            </p>
          ) : (
            <div className="space-y-2">
              {portDrafts.map((draft) => (
                <div
                  key={draft.draftId}
                  className="flex flex-col gap-2 rounded-lg border px-3 py-3 lg:flex-row lg:items-center lg:justify-between"
                  data-testid={`service-port-row-${serviceId}-${draft.draftId}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="number"
                      value={draft.hostPort}
                      onChange={(event) =>
                        updateDraft(draft.draftId, { hostPort: event.target.value })
                      }
                      className="h-8 w-28 text-sm font-mono"
                      data-testid={`service-port-row-host-${serviceId}-${draft.draftId}`}
                    />
                    <span className="text-muted-foreground">→</span>
                    <Input
                      type="number"
                      value={draft.containerPort}
                      onChange={(event) =>
                        updateDraft(draft.draftId, { containerPort: event.target.value })
                      }
                      className="h-8 w-32 text-sm font-mono"
                      data-testid={`service-port-row-container-${serviceId}-${draft.draftId}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateDraft(draft.draftId, {
                          protocol: draft.protocol === "tcp" ? "udp" : "tcp"
                        })
                      }
                      data-testid={`service-port-row-protocol-${serviceId}-${draft.draftId}`}
                    >
                      {draft.protocol.toUpperCase()}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeDraft(draft.draftId)}
                    aria-label={`Remove port mapping ${draft.hostPort} to ${draft.containerPort}`}
                    data-testid={`service-port-remove-${serviceId}-${draft.draftId}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {portFeedback ? (
            <p
              className="mt-4 text-sm text-muted-foreground"
              data-testid={`service-port-feedback-${serviceId}`}
            >
              {portFeedback}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={resetPorts}
              disabled={!portsDirty || updatePortMappings.isPending}
              data-testid={`service-port-reset-${serviceId}`}
            >
              <RotateCcw size={14} className="mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSavePorts()}
              disabled={!portsDirty || updatePortMappings.isPending}
              data-testid={`service-port-save-${serviceId}`}
            >
              <Save size={14} className="mr-1" />
              {updatePortMappings.isPending ? "Saving..." : "Save Mappings"}
            </Button>
          </div>
        </CardContent>
      </Card>

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
            <Badge
              variant="outline"
              className="text-xs border-emerald-500/40 text-emerald-600"
              data-testid={`service-proxy-matched-${serviceId}`}
            >
              Matched {domainState.data.summary.matchedDomainCount}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs border-amber-500/40 text-amber-600"
              data-testid={`service-proxy-missing-${serviceId}`}
            >
              Missing {domainState.data.summary.missingDomainCount}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs border-slate-400/40 text-slate-600"
              data-testid={`service-proxy-inactive-${serviceId}`}
            >
              Inactive {domainState.data.summary.inactiveDomainCount}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs border-red-500/40 text-red-600"
              data-testid={`service-proxy-conflict-${serviceId}`}
            >
              Conflict {domainState.data.summary.conflictDomainCount}
            </Badge>
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
    </div>
  );
}
