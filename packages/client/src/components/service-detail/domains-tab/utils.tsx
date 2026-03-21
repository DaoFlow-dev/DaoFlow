import { isTRPCClientError } from "@trpc/client";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type {
  DomainProxyStatus,
  DomainTlsStatus,
  PortMappingDraft,
  ServicePortMappingRecord
} from "./types";

export function createDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export function toPortDrafts(mappings: ServicePortMappingRecord[]): PortMappingDraft[] {
  return mappings.map((mapping) => ({
    draftId: mapping.id,
    id: mapping.id,
    hostPort: String(mapping.hostPort),
    containerPort: String(mapping.containerPort),
    protocol: mapping.protocol
  }));
}

export function serializePortMappings(
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

export function formatMutationError(error: unknown, fallback: string) {
  return isTRPCClientError(error) ? error.message : fallback;
}

export function parsePort(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}

export function statusBadgeClass(status: DomainProxyStatus | DomainTlsStatus) {
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

export function renderTlsIcon(status: DomainTlsStatus) {
  switch (status) {
    case "ready":
      return <ShieldCheck size={14} className="text-emerald-600" />;
    case "conflict":
      return <ShieldAlert size={14} className="text-red-600" />;
    default:
      return <Shield size={14} className="text-muted-foreground" />;
  }
}
