import type { SwarmTopologySnapshot } from "@daoflow/shared";

interface SwarmTopologySummaryProps {
  serverId: string;
  topology: SwarmTopologySnapshot;
}

function pluralize(label: string, count: number) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

export function SwarmTopologySummary({ serverId, topology }: SwarmTopologySummaryProps) {
  return (
    <div
      className="rounded-xl border border-border/60 bg-muted/30 p-4"
      data-testid={`swarm-topology-${serverId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Swarm Topology</p>
          <p className="text-sm text-muted-foreground">
            {topology.clusterName} · {topology.source}
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <p>{pluralize("manager", topology.summary.managerCount)}</p>
          <p>{pluralize("worker", topology.summary.workerCount)}</p>
        </div>
      </div>

      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {topology.nodes.map((node) => (
          <li key={node.id} data-testid={`swarm-topology-node-${serverId}-${node.id}`}>
            {node.name} · {node.role} · {node.availability} · {node.reachability}
          </li>
        ))}
      </ul>
    </div>
  );
}
