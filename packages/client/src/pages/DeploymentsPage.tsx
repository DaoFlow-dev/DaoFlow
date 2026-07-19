import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import DeploymentRollbackDialog from "@/components/DeploymentRollbackDialog";
import { DeploymentHistoryCard } from "./deployments-page/DeploymentHistoryCard";
import { DeploymentsFilters } from "./deployments-page/DeploymentsFilters";
import type { DeploymentRowData } from "./deployments-page/types";
import { matchesDeploymentFilters } from "./deployments-page/utils";
import { queryErrorMessage } from "@/lib/query-error-message";

export default function DeploymentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const session = useSession();
  const requestedDeploymentId = searchParams.get("deployment");
  const [expandedId, setExpandedId] = useState<string | null>(requestedDeploymentId);
  const [rollbackServiceId, setRollbackServiceId] = useState<string | null>(null);
  const [cancelingDeploymentId, setCancelingDeploymentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    { enabled: Boolean(session.data) }
  );
  const linkedDeployment = trpc.deploymentDetails.useQuery(
    { deploymentId: requestedDeploymentId ?? "" },
    { enabled: Boolean(session.data && requestedDeploymentId) }
  );

  const cancelMut = trpc.cancelDeployment.useMutation({
    onSuccess: () => void recentDeployments.refetch(),
    onSettled: () => setCancelingDeploymentId(null)
  });

  const recentRows = (recentDeployments.data ?? []) as DeploymentRowData[];
  const linkedRow = linkedDeployment.data as DeploymentRowData | undefined;
  const deployments =
    linkedRow && !recentRows.some((deployment) => deployment.id === linkedRow.id)
      ? [linkedRow, ...recentRows]
      : recentRows;
  const filteredDeployments = deployments.filter((deployment) =>
    matchesDeploymentFilters(deployment, searchQuery, statusFilter)
  );

  useEffect(() => {
    setExpandedId(requestedDeploymentId);
  }, [requestedDeploymentId]);

  const handleToggleExpand = useCallback(
    (id: string) => {
      const nextExpandedId = expandedId === id ? null : id;
      setExpandedId(nextExpandedId);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextExpandedId) {
            next.set("deployment", nextExpandedId);
          } else {
            next.delete("deployment");
          }
          return next;
        },
        { replace: true }
      );
    },
    [expandedId, setSearchParams]
  );

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
        errorMessage={
          recentDeployments.isError
            ? queryErrorMessage(recentDeployments.error, "Unable to load deployment history.")
            : null
        }
        isRetrying={recentDeployments.isFetching}
        deployments={deployments}
        filteredDeployments={filteredDeployments}
        expandedId={expandedId}
        cancelingDeploymentId={cancelingDeploymentId}
        onClearFilters={handleClearFilters}
        onOpenDeployCenter={() => void navigate("/deploy")}
        onRetry={() => void recentDeployments.refetch()}
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
