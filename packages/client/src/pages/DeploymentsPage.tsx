import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Rocket } from "lucide-react";

export default function DeploymentsPage() {
  const session = useSession();
  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    { enabled: Boolean(session.data) }
  );

  const deployments = recentDeployments.data ?? [];

  return (
    <main className="shell space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          View deployment history and status across all services.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deployment History</CardTitle>
          <CardDescription>
            {deployments.length} deployment{deployments.length !== 1 ? "s" : ""}
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
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.map((d) => (
                  <TableRow key={String(d.id)}>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
