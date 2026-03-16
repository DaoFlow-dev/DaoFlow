import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Rocket, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import DeploymentLogViewer from "../components/DeploymentLogViewer";
import DeploymentRollbackDialog from "../components/DeploymentRollbackDialog";

export default function DeploymentsPage() {
  const session = useSession();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rollbackServiceId, setRollbackServiceId] = useState<string | null>(null);

  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    { enabled: Boolean(session.data) }
  );

  const deployments = recentDeployments.data ?? [];

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <main className="shell space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          View deployment history, logs, and rollback options.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deployment History</CardTitle>
          <CardDescription>
            {deployments.length} deployment
            {deployments.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentDeployments.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : deployments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Rocket size={32} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No deployments yet. Queue your first deployment to get started.
              </p>
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
                {deployments.map((d) => {
                  const id = String(d.id);
                  const isExpanded = expandedId === id;
                  const isSuccessful = d.status === "healthy";

                  return (
                    <>
                      <TableRow
                        key={id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(id)}
                      >
                        <TableCell className="px-2">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </TableCell>
                        <TableCell className="font-medium">
                          {String(d.serviceName ?? d.projectId ?? "—")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              d.status === "healthy"
                                ? "default"
                                : d.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {String(d.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {String(d.sourceType ?? "docker")}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {isSuccessful && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Use serviceName to find service for rollback
                                setRollbackServiceId(String(d.serviceName ?? ""));
                              }}
                            >
                              <RotateCcw size={14} className="mr-1" />
                              Rollback
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${id}-logs`}>
                          <TableCell colSpan={6} className="p-0">
                            <DeploymentLogViewer deploymentId={id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Rollback dialog — uses serviceName as serviceId lookup */}
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
