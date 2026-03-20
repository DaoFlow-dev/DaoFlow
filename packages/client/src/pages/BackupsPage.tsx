import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { BackupRunDetailsSheet } from "@/components/backups/BackupRunDetailsSheet";
import { BackupEmptyState } from "@/components/backups/BackupEmptyState";
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
import { Plus, Clock, PlayCircle, StopCircle, RotateCcw } from "lucide-react";
import { getBackupOperationBadgeVariant, formatBytes } from "../lib/tone-utils";
import { isTRPCClientError } from "@trpc/client";

export default function BackupsPage() {
  const session = useSession();
  const backupOverview = trpc.backupOverview.useQuery({}, { enabled: Boolean(session.data) });
  const policies = backupOverview.data?.policies ?? [];
  const runs = backupOverview.data?.runs ?? [];
  const shouldLoadDestinations =
    Boolean(session.data) &&
    !backupOverview.isLoading &&
    policies.length === 0 &&
    runs.length === 0;
  const backupDestinations = trpc.backupDestinations.useQuery(
    {},
    { enabled: shouldLoadDestinations }
  );

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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const backupRunDetails = trpc.backupRunDetails.useQuery(
    {
      runId: selectedRunId ?? ""
    },
    {
      enabled: Boolean(session.data && selectedRunId)
    }
  );
  const backupRunDetailStatus = backupRunDetails.data?.status;
  const refetchBackupRunDetails = backupRunDetails.refetch;

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }

    if (!backupRunDetailStatus) {
      return;
    }

    if (!["queued", "running"].includes(backupRunDetailStatus)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refetchBackupRunDetails();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [backupRunDetailStatus, refetchBackupRunDetails, selectedRunId]);

  const hasDestinations = (backupDestinations.data?.length ?? 0) > 0;
  const detailsErrorMessage = isTRPCClientError(backupRunDetails.error)
    ? backupRunDetails.error.message
    : backupRunDetails.error
      ? "Unable to load backup run diagnostics right now."
      : null;

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

      {backupOverview.isLoading || backupDestinations.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : policies.length === 0 && runs.length === 0 ? (
        <BackupEmptyState hasDestinations={hasDestinations} />
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
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant={String(r.status) === "failed" ? "default" : "outline"}
                              data-testid={`backup-run-inspect-${String(r.id)}`}
                              onClick={() => setSelectedRunId(String(r.id))}
                            >
                              Inspect
                            </Button>
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
                          </div>
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

      <BackupRunDetailsSheet
        open={selectedRunId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRunId(null);
          }
        }}
        isLoading={backupRunDetails.isLoading}
        errorMessage={detailsErrorMessage}
        run={backupRunDetails.data}
      />
    </main>
  );
}
