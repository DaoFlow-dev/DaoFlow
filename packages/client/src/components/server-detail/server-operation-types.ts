import type { SwarmTopologySnapshot } from "@daoflow/shared";

export interface ServerOperation {
  id: string;
  kind: string;
  status: string;
  dryRun: boolean;
  summary: string | null;
  result: unknown;
  createdAt: string;
  completedAt: string | null;
}

export interface ResourceResult {
  checkedAt?: string;
  cpu?: { cores?: number | null; load1?: number | null; loadPercent?: number | null };
  memory?: { totalMb?: number | null; availableMb?: number | null; usedPercent?: number | null };
  disk?: { totalGb?: number | null; usedGb?: number | null; usedPercent?: number | null };
  docker?: {
    reachable?: boolean;
    diskUsage?: Array<{ type: string; size: string; reclaimable: string }>;
  };
}

export type ServerSummary = {
  id: string;
  name: string;
  host: string;
  kind: string;
  status: string;
  swarmTopology: SwarmTopologySnapshot | null;
  maxConcurrentBuilds: number;
  maxQueuedDeployments: number;
};

export type ServerOperationsHub = {
  server: ServerSummary;
  latestResource: ResourceResult | null;
  operations: ServerOperation[];
};
