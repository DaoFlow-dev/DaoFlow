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
import { DatabaseBackup, Plus } from "lucide-react";

export default function BackupsPage() {
  const session = useSession();
  const backupOverview = trpc.backupOverview.useQuery({}, { enabled: Boolean(session.data) });

  const policies = backupOverview.data?.policies ?? [];
  const runs = backupOverview.data?.runs ?? [];

  return (
    <main className="shell space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backups</h1>
          <p className="text-sm text-muted-foreground">
            Manage backup policies, view run history, and restore data.
          </p>
        </div>
        <Button disabled>
          <Plus size={16} /> New Policy
        </Button>
      </div>

      {backupOverview.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : policies.length === 0 && runs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <DatabaseBackup size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No backup policies configured. Create a policy to start backing up your data.
          </p>
        </div>
      ) : (
        <>
          {/* Policies */}
          {policies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Backup Policies</CardTitle>
                <CardDescription>
                  {policies.length} policy{policies.length !== 1 ? "ies" : "y"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {policies.map((p) => (
                    <div key={String(p.id)} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-sm font-semibold">{String(p.serviceName)}</p>
                        <Badge variant="secondary">{String(p.targetType)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Schedule: {String(p.scheduleLabel ?? "manual")} · Storage:{" "}
                        {String(p.storageProvider)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Retention: {p.retentionCount} backups · Last:{" "}
                        {p.lastRunAt ? new Date(p.lastRunAt).toLocaleDateString() : "never"}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Runs */}
          {runs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Runs</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Finished</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={String(r.id)}>
                        <TableCell className="font-medium">
                          {String(r.serviceName ?? r.policyId)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.status === "succeeded"
                                ? "default"
                                : r.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {String(r.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {String(r.triggerKind)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
