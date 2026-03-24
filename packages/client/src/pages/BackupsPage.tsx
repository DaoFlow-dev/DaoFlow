import { useState } from "react";
import { BackupRunDetailsSheet } from "@/components/backups/BackupRunDetailsSheet";
import { BackupEmptyState } from "@/components/backups/BackupEmptyState";
import { BackupPolicyManager } from "@/components/backups/BackupPolicyManager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { RotateCcw } from "lucide-react";
import { isTRPCClientError } from "@trpc/client";
import { Link } from "react-router-dom";
import { useBackupRunDetails } from "@/features/backups/useBackupRunDetails";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { getBackupOperationBadgeVariant, formatBytes } from "@/lib/tone-utils";

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
  const queueBackupRestore = trpc.queueBackupRestore.useMutation();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [restoreFeedback, setRestoreFeedback] = useState<string | null>(null);
  const { errorMessage: detailsErrorMessage, query: backupRunDetails } =
    useBackupRunDetails(selectedRunId);

  const hasDestinations = (backupDestinations.data?.length ?? 0) > 0;

  async function handleQueueBackupRestore(runId: string, serviceName: string) {
    setRestoreFeedback(null);

    try {
      await queueBackupRestore.mutateAsync({
        backupRunId: runId
      });
      await backupOverview.refetch();
      setRestoreFeedback(`Queued restore for ${serviceName}.`);
    } catch (error) {
      setRestoreFeedback(
        isTRPCClientError(error) ? error.message : "Unable to queue the restore right now."
      );
    }
  }

  return (
    <main className="shell space-y-6" data-testid="backup-overview">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Backups</h1>
          <p className="text-sm text-muted-foreground">
            Manage backup policies, schedules, and run history.
          </p>
        </div>
      </div>

      {restoreFeedback ? (
        <p
          className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
          data-testid="backup-restore-feedback"
        >
          {restoreFeedback}
        </p>
      ) : null}

      {backupOverview.isLoading || backupDestinations.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : policies.length === 0 && runs.length === 0 ? (
        <BackupEmptyState hasDestinations={hasDestinations} />
      ) : (
        <>
          <BackupPolicyManager />

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
                          {r.bytesWritten ? formatBytes(Number(r.bytesWritten)) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {String(r.triggerKind)}
                          {r.temporalWorkflowId ? (
                            <div className="break-all text-xs">{String(r.temporalWorkflowId)}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.finishedAt ? new Date(r.finishedAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Link
                              to={`/backups/runs/${String(r.id)}`}
                              className={buttonVariants({
                                size: "sm",
                                variant: String(r.status) === "failed" ? "default" : "outline"
                              })}
                              data-testid={`backup-run-open-page-${String(r.id)}`}
                            >
                              Diagnostics
                            </Link>
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid={`backup-run-inspect-${String(r.id)}`}
                              onClick={() => setSelectedRunId(String(r.id))}
                            >
                              Quick inspect
                            </Button>
                            {String(r.status) === "succeeded" && r.artifactPath ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={queueBackupRestore.isPending}
                                data-testid={`backup-run-queue-restore-${String(r.id)}`}
                                onClick={() => {
                                  void handleQueueBackupRestore(
                                    String(r.id),
                                    String(r.serviceName ?? r.policyId)
                                  );
                                }}
                              >
                                <RotateCcw size={14} className="mr-1" />
                                Queue restore
                              </Button>
                            ) : null}
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
