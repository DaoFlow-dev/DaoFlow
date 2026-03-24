import { useCallback, useState } from "react";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import DeploymentRollbackDialog from "@/components/DeploymentRollbackDialog";
import { DeploymentHistoryCard } from "./deployments-page/DeploymentHistoryCard";
import { DeploymentsFilters } from "./deployments-page/DeploymentsFilters";
import type { DeploymentRowData } from "./deployments-page/types";
import { matchesDeploymentFilters } from "./deployments-page/utils";

export default function DeploymentsPage() {
  const session = useSession();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rollbackServiceId, setRollbackServiceId] = useState<string | null>(null);
  const [cancelingDeploymentId, setCancelingDeploymentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    { enabled: Boolean(session.data) }
  );

  const cancelMut = trpc.cancelDeployment.useMutation({
    onSuccess: () => void recentDeployments.refetch(),
    onSettled: () => setCancelingDeploymentId(null)
  });

  const deployments = (recentDeployments.data ?? []) as DeploymentRowData[];
  const filteredDeployments = deployments.filter((deployment) =>
    matchesDeploymentFilters(deployment, searchQuery, statusFilter)
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleOpenRollback = useCallback((serviceId: string) => {
    setRollbackServiceId(serviceId);
  }, []);

  const { mutate: cancelDeployment } = cancelMut;

  const handleCancelDeployment = useCallback(
    (deploymentId: string) => {
      if (window.confirm("Cancel this deployment?")) {
        setCancelingDeploymentId(deploymentId);
        cancelDeployment({ deploymentId });
      }
    },
    [cancelDeployment]
  );

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setStatusFilter("all");
  }, []);

  return (
    <main className="shell space-y-6" data-testid="deployments-page">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          View deployment history, logs, and rollback options.
        </p>
      </div>

      <DeploymentsFilters
        searchQuery={searchQuery}
        statusFilter={statusFilter}
        onSearchQueryChange={setSearchQuery}
        onStatusFilterChange={setStatusFilter}
      />

      <DeploymentHistoryCard
        isLoading={recentDeployments.isLoading}
        deployments={deployments}
        filteredDeployments={filteredDeployments}
        expandedId={expandedId}
        cancelingDeploymentId={cancelingDeploymentId}
        onClearFilters={handleClearFilters}
        onToggleExpand={handleToggleExpand}
        onOpenRollback={handleOpenRollback}
        onCancelDeployment={handleCancelDeployment}
      />
      {rollbackServiceId && (
        <DeploymentRollbackDialog
          serviceId={rollbackServiceId}
          open={!!rollbackServiceId}
          onOpenChange={(open) => {
            if (!open) setRollbackServiceId(null);
          }}
          onRolledBack={() => void recentDeployments.refetch()}
        />
      )}
    </main>
  );
}
export { DeploymentRow } from "./deployments-page/DeploymentRow";
