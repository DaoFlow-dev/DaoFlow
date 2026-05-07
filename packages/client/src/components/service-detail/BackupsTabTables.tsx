import { Link } from "react-router-dom";
import { ArchiveRestore, DatabaseBackup, HardDrive, PlayCircle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { formatBytes, getBackupOperationBadgeVariant } from "@/lib/tone-utils";
import type { ServiceBackupWorkflow } from "./backups-tab-types";

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "n/a";
}

export function BackupSummaryGrid({ data }: { data: ServiceBackupWorkflow }) {
  const items = [
    {
      icon: HardDrive,
      value: data.summary.totalVolumes,
      label: "Volumes",
      testId: "service-backups-total-volumes"
    },
    {
      icon: ShieldCheck,
      value: data.summary.protectedVolumes,
      label: "Protected",
      testId: "service-backups-protected"
    },
    {
      icon: DatabaseBackup,
      value: data.summary.failedRuns,
      label: "Failed runs",
      testId: "service-backups-failed-runs"
    },
    {
      icon: ArchiveRestore,
      value: data.summary.restoreRequests,
      label: "Restores",
      testId: "service-backups-restores"
    }
  ];

  return (
    <div className="grid gap-3 md:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.testId}>
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-semibold" data-testid={item.testId}>
                  {item.value}
                </p>
                <p className="text-xs text-muted-foreground">{item.label}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function BackupVolumesTable({ data }: { data: ServiceBackupWorkflow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Service volumes</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Volume</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Retention</TableHead>
              <TableHead>Last backup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.volumes.map((volume) => {
              const policy = data.policies.find(
                (candidate) => candidate.id === volume.backupPolicyId
              );
              return (
                <TableRow key={volume.id} data-testid={`service-backups-volume-${volume.id}`}>
                  <TableCell>
                    <div className="font-medium">{volume.volumeName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {volume.mountPath}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={volume.backupCoverage === "protected" ? "default" : "secondary"}
                    >
                      {volume.backupCoverage}
                    </Badge>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {volume.restoreReadiness}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatBytes(Number(volume.sizeBytes))}
                  </TableCell>
                  <TableCell>
                    {volume.storageProvider ?? policy?.destinationName ?? "n/a"}
                  </TableCell>
                  <TableCell>{policy ? `${policy.retentionDays} days` : "n/a"}</TableCell>
                  <TableCell>{formatDate(volume.lastBackupAt ?? policy?.lastRunAt)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function BackupPoliciesAndRuns({
  data,
  runPending,
  onRunBackup,
  onPreviewRestore
}: {
  data: ServiceBackupWorkflow;
  runPending: boolean;
  onRunBackup: (policyId: string, policyName: string) => void;
  onPreviewRestore: (runId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Policies and recent runs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          {data.policies.map((policy) => (
            <div
              key={policy.id}
              className="rounded-lg border p-4"
              data-testid={`service-backups-policy-${policy.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{policy.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {policy.schedule} · {policy.backupType} · {policy.retentionDays} days
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runPending}
                  onClick={() => onRunBackup(policy.id, policy.name)}
                  data-testid={`service-backups-run-${policy.id}`}
                >
                  <PlayCircle className="mr-1 size-3" />
                  Run
                </Button>
              </div>
            </div>
          ))}
        </div>
        <BackupRunsTable runs={data.runs} onPreviewRestore={onPreviewRestore} />
      </CardContent>
    </Card>
  );
}

function BackupRunsTable({
  runs,
  onPreviewRestore
}: {
  runs: ServiceBackupWorkflow["runs"];
  onPreviewRestore: (runId: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Artifact</TableHead>
          <TableHead>Finished</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id} data-testid={`service-backups-run-row-${run.id}`}>
            <TableCell>
              <Badge variant={getBackupOperationBadgeVariant(run.status)}>{run.status}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {run.bytesWritten ? formatBytes(Number(run.bytesWritten)) : "n/a"}
            </TableCell>
            <TableCell className="max-w-[18rem] truncate font-mono text-xs text-muted-foreground">
              {run.artifactPath ?? "n/a"}
            </TableCell>
            <TableCell>{formatDate(run.finishedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <Link
                  to={`/backups/runs/${run.id}`}
                  className={buttonVariants({ size: "sm", variant: "ghost" })}
                  data-testid={`service-backups-diagnostics-${run.id}`}
                >
                  Logs
                </Link>
                {run.status === "succeeded" && run.artifactPath ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onPreviewRestore(run.id)}
                    data-testid={`service-backups-preview-restore-${run.id}`}
                  >
                    Preview restore
                  </Button>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
