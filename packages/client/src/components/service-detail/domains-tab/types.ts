export type DomainProxyStatus = "matched" | "missing" | "inactive" | "conflict";
export type DomainTlsStatus = "ready" | "pending" | "inactive" | "conflict";
export type ServicePortProtocol = "tcp" | "udp";

export interface ObservedRouteRecord {
  hostname: string;
  service: string;
  path: string | null;
  status: string;
  tunnelId: string;
  tunnelName: string;
}

export interface ServiceDomainStateRecord {
  id: string;
  hostname: string;
  isPrimary: boolean;
  createdAt: string;
  proxyStatus: DomainProxyStatus;
  tlsStatus: DomainTlsStatus;
  observedRoute: ObservedRouteRecord | null;
}

export interface ServicePortMappingRecord {
  id: string;
  hostPort: number;
  containerPort: number;
  protocol: ServicePortProtocol;
  createdAt: string;
}

export interface ServiceDomainSummary {
  primaryDomain: string | null;
  desiredDomainCount: number;
  matchedDomainCount: number;
  missingDomainCount: number;
  inactiveDomainCount: number;
  conflictDomainCount: number;
}

export interface PortMappingDraft {
  draftId: string;
  id?: string;
  hostPort: string;
  containerPort: string;
  protocol: ServicePortProtocol;
}
