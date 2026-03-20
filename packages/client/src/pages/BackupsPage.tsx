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
import { Input } from "@/components/ui/input";
import { DatabaseBackup, Plus, Clock, PlayCircle, StopCircle, RotateCcw } from "lucide-react";
import { getBackupOperationBadgeVariant, formatBytes } from "../lib/tone-utils";

export default function BackupsPage() {
  const session = useSession();
  const backupOverview = trpc.backupOverview.useQuery({}, { enabled: Boolean(session.data) });

  const enableSchedule = trpc.enableBackupSchedule.useMutation({
    onSuccess: () => backupOverview.refetch()
  });
  const disableSchedule = trpc.disableBackupSchedule.useMutation({
    onSuccess: () => backupOverview.refetch()
  });
  const triggerNow = trpc.triggerBackupNow.useMutation({
    onSuccess: () => backupOverview.refetch()
  });

  const [cronInputs, setCronInputs] = useState<Record<string, string>>({});

  const policies = backupOverview.data?.policies ?? [];
  const runs = backupOverview.data?.runs ?? [];

  return (
    <main className="shell space-y-6" data-testid="backup-overview">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backups</h1>
          <p className="text-sm text-muted-foreground">
            Manage backup policies, schedules, and run history.
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
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
            <DatabaseBackup size={28} className="text-primary/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No backup policies configured</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a policy to start backing up your data.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Policies */}
          {policies.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Backup Policies</CardTitle>
                <CardDescription>
                  {policies.length} policy{policies.length !== 1 ? "ies" : "y"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {policies.map((p) => {
                    const policyId = String(p.id);
                    const hasSchedule = Boolean(p.scheduleLabel);

                    return (
                      <div
                        key={policyId}
                        className="rounded-xl border border-border/50 p-5 space-y-3 shadow-sm transition-all duration-200 hover:shadow-md"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{String(p.serviceName)}</p>
                          <div className="flex items-center gap-1">
                            {hasSchedule && (
                              <Badge variant="default" className="text-xs">
                                <Clock size={10} className="mr-1" />
                                {String(p.scheduleLabel)}
                              </Badge>
                            )}
                            <Badge variant="secondary">{String(p.targetType)}</Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Destination:{" "}
                          {String(p.storageProvider) === "(none)" ? (
                            <a href="/destinations" className="underline">
                              configure
                            </a>
                          ) : (
                            String(p.storageProvider)
                          )}{" "}
                          · Retention: {p.retentionCount} backups
                        </p>

                        {/* Schedule Controls */}
                        <div className="flex items-center gap-2 pt-1">
                          {hasSchedule ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={disableSchedule.isPending}
                                onClick={() => disableSchedule.mutate({ policyId })}
                              >
                                <StopCircle size={14} className="mr-1" />
                                Disable
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={triggerNow.isPending}
                                onClick={() => triggerNow.mutate({ policyId })}
                              >
                                <PlayCircle size={14} className="mr-1" />
                                Run Now
                              </Button>
                            </>
                          ) : (
                            <>
                              <Input
                                placeholder="0 */6 * * *"
                                className="h-8 w-36 text-xs"
                                value={cronInputs[policyId] ?? ""}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                  setCronInputs((prev) => ({
                                    ...prev,
                                    [policyId]: e.target.value
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                disabled={!cronInputs[policyId]?.trim() || enableSchedule.isPending}
                                onClick={() =>
                                  enableSchedule.mutate({
                                    policyId,
                                    schedule: (cronInputs[policyId] ?? "").trim()
                                  })
                                }
                              >
                                <Clock size={14} className="mr-1" />
                                Enable
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={triggerNow.isPending}
                                onClick={() => triggerNow.mutate({ policyId })}
                              >
                                <PlayCircle size={14} className="mr-1" />
                                Run Now
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Runs */}
          {runs.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Recent Runs</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Finished</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={String(r.id)}>
                        <TableCell className="font-medium">
                          {String(r.serviceName ?? r.policyId)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getBackupOperationBadgeVariant(String(r.status))}>
                            {String(r.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {(r as Record<string, unknown>).sizeBytes
                            ? formatBytes(Number((r as Record<string, unknown>).sizeBytes))
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {String(r.triggerKind)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {String(r.status) === "succeeded" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled
                              title="Restore from this backup"
                            >
                              <RotateCcw size={14} className="mr-1" />
                              Restore
                            </Button>
                          )}
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
