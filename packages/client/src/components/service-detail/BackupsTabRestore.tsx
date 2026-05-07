import { ArchiveRestore, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { getBackupOperationBadgeVariant } from "@/lib/tone-utils";
import type {
  BackupRestorePlan,
  ServiceBackupRestore,
  ServiceBackupRun
} from "./backups-tab-types";

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "n/a";
}

export function BackupRestorePreview({
  plan,
  planError,
  isLoading,
  isPending,
  previewRunId,
  selectedRun,
  onQueueRestore
}: {
  plan: BackupRestorePlan | undefined;
  planError: { message: string } | null;
  isLoading: boolean;
  isPending: boolean;
  previewRunId: string;
  selectedRun: ServiceBackupRun | undefined;
  onQueueRestore: () => void;
}) {
  return (
    <Card data-testid="service-backups-restore-preview">
      <CardHeader>
        <CardTitle className="text-base">Restore preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Skeleton className="h-24 w-full" /> : null}
        {planError ? (
          <Alert variant="destructive">
            <AlertTitle>Restore cannot be previewed</AlertTitle>
            <AlertDescription>{planError.message}</AlertDescription>
          </Alert>
        ) : null}
        {plan ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <p className="rounded-lg border p-3 text-sm">
                Target: <span className="font-mono">{plan.target.path}</span>
              </p>
              <p className="rounded-lg border p-3 text-sm">
                Artifact: <span className="font-mono">{plan.backupRun.artifactPath}</span>
              </p>
            </div>
            <ul className="space-y-2 text-sm" data-testid="service-backups-restore-checks">
              {plan.preflightChecks.map((check, index) => (
                <li key={`${check.status}-${index}`} className="rounded-lg border px-3 py-2">
                  <Badge className="mr-2" variant={check.status === "ok" ? "default" : "secondary"}>
                    {check.status}
                  </Badge>
                  {check.detail}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {selectedRun
                  ? `Run ${selectedRun.id} was previewed before restore.`
                  : "Restore preview ready."}
              </p>
              <Button
                disabled={!plan.isReady || isLoading || isPending}
                onClick={onQueueRestore}
                data-testid={`service-backups-queue-restore-${previewRunId}`}
              >
                {isPending ? (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                ) : (
                  <ArchiveRestore className="mr-1 size-3" />
                )}
                Queue restore
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function BackupRestoreHistory({ restores }: { restores: ServiceBackupRestore[] }) {
  if (restores.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Restore history</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead>Requested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {restores.map((restore) => (
              <TableRow key={restore.id} data-testid={`service-backups-restore-${restore.id}`}>
                <TableCell>
                  <Badge variant={getBackupOperationBadgeVariant(restore.status)}>
                    {restore.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{restore.targetPath}</TableCell>
                <TableCell>{restore.requestedBy}</TableCell>
                <TableCell>{formatDate(restore.requestedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
