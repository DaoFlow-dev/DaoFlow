import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeploymentRow } from "./DeploymentRow";
import type { DeploymentRowData } from "./types";

interface DeploymentHistoryCardProps {
  isLoading: boolean;
  deployments: DeploymentRowData[];
  filteredDeployments: DeploymentRowData[];
  expandedId: string | null;
  cancelingDeploymentId: string | null;
  onClearFilters: () => void;
  onToggleExpand: (deploymentId: string) => void;
  onOpenRollback: (serviceId: string) => void;
  onCancelDeployment: (deploymentId: string) => void;
}

export function DeploymentHistoryCard({
  isLoading,
  deployments,
  filteredDeployments,
  expandedId,
  cancelingDeploymentId,
  onClearFilters,
  onToggleExpand,
  onOpenRollback,
  onCancelDeployment
}: DeploymentHistoryCardProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Deployment History</CardTitle>
        <CardDescription>
          {filteredDeployments.length} of {deployments.length} deployment
          {deployments.length !== 1 ? "s" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : deployments.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
              <Rocket size={28} className="text-primary/50" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No deployments yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Queue your first deployment to get started.
              </p>
            </div>
          </div>
        ) : filteredDeployments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-sm text-muted-foreground">No deployments match your filters.</p>
            <Button size="sm" variant="ghost" onClick={onClearFilters}>
              Clear filters
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeployments.map((deployment) => {
                const id = String(deployment.id);
                return (
                  <DeploymentRow
                    key={id}
                    deployment={deployment}
                    isExpanded={expandedId === id}
                    cancelPending={cancelingDeploymentId === id}
                    onToggleExpand={onToggleExpand}
                    onOpenRollback={onOpenRollback}
                    onCancelDeployment={onCancelDeployment}
                  />
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
