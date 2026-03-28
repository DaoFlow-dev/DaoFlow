export interface ServiceEndpointLink {
  id: string;
  kind: "domain" | "port";
  label: string;
  href: string | null;
  copyValue: string;
  status: "healthy" | "pending" | "failed" | "unavailable";
  statusLabel: string;
  statusTone: string;
  summary: string;
  isCanonical: boolean;
  isPublic: boolean;
}

export interface ServiceEndpointSummary {
  status: "healthy" | "pending" | "failed" | "unavailable";
  statusLabel: string;
  statusTone: string;
  summary: string;
  primaryLabel: string | null;
  primaryHref: string | null;
  links: ServiceEndpointLink[];
}
