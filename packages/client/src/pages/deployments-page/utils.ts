import type { DeploymentRowData } from "./types";

export function formatRelative(iso: string | Date | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function matchesDeploymentFilters(
  deployment: DeploymentRowData,
  searchQuery: string,
  statusFilter: string
): boolean {
  const matchesSearch = searchQuery
    ? String(deployment.serviceName ?? deployment.projectId ?? "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
    : true;
  const matchesStatus =
    statusFilter === "all"
      ? true
      : String(deployment.statusLabel).toLowerCase() === statusFilter.toLowerCase();

  return matchesSearch && matchesStatus;
}
