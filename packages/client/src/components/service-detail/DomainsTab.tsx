import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { CustomDomainsCard } from "./domains-tab/CustomDomainsCard";
import { PortMappingsCard } from "./domains-tab/PortMappingsCard";
import { ReverseProxyStatusCard } from "./domains-tab/ReverseProxyStatusCard";
import type {
  PortMappingDraft,
  ServiceDomainStateRecord,
  ServicePortProtocol
} from "./domains-tab/types";
import {
  createDraftId,
  formatMutationError,
  parsePort,
  serializePortMappings,
  toPortDrafts
} from "./domains-tab/utils";

interface DomainsTabProps {
  serviceId: string;
  serviceName: string;
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
  const domainData = domainState.data;

  useEffect(() => {
    if (!isEditingPorts) {
      setPortDrafts(toPortDrafts(domainData?.portMappings ?? []));
    }
  }, [domainData?.portMappings, isEditingPorts]);

  async function refreshOperationalViews() {
    await Promise.all([
      utils.serviceDomainState.invalidate({ serviceId }),
      utils.serviceDetails.invalidate({ serviceId })
    ]);
  }

  const baselinePorts = serializePortMappings(
    (domainData?.portMappings ?? []).map((mapping) => ({
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
    setPortDrafts(toPortDrafts(domainData?.portMappings ?? []));
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

  if (domainState.error || !domainData) {
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
      <CustomDomainsCard
        serviceId={serviceId}
        newDomain={newDomain}
        domainMutating={domainMutating}
        summary={domainData.summary}
        domains={domainData.domains}
        domainFeedback={domainFeedback}
        onNewDomainChange={setNewDomain}
        onAddDomain={() => void handleAddDomain()}
        onSetPrimary={(domain) => void handleSetPrimary(domain)}
        onRemoveDomain={(domain) => void handleRemoveDomain(domain)}
      />
      <PortMappingsCard
        serviceId={serviceId}
        serviceName={serviceName}
        portDrafts={portDrafts}
        newHostPort={newHostPort}
        newContainerPort={newContainerPort}
        newProtocol={newProtocol}
        portFeedback={portFeedback}
        portsDirty={portsDirty}
        isSaving={updatePortMappings.isPending}
        onNewHostPortChange={setNewHostPort}
        onNewContainerPortChange={setNewContainerPort}
        onToggleNewProtocol={() => setNewProtocol((current) => (current === "tcp" ? "udp" : "tcp"))}
        onAddPortDraft={handleAddPortDraft}
        onUpdateDraft={updateDraft}
        onRemoveDraft={removeDraft}
        onResetPorts={resetPorts}
        onSavePorts={() => void handleSavePorts()}
      />
      <ReverseProxyStatusCard serviceId={serviceId} summary={domainData.summary} />
    </div>
  );
}
