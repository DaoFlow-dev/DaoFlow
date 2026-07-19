import { useMemo, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { formatBytes, getBackupOperationBadgeVariant } from "@/lib/tone-utils";

interface RestoreTargetPolicy {
  id: string;
  volumeId: string;
  serviceName: string;
  environmentName: string;
  backupType: string;
  databaseEngine: string | null;
}

export function ExternalBackupArtifacts({
  policies,
  enabled
}: {
  policies: RestoreTargetPolicy[];
  enabled: boolean;
}) {
  const artifacts = trpc.externalBackupArtifacts.useQuery(
    { limit: 50 },
    { enabled, refetchInterval: 5_000 }
  );
  const verifyArtifact = trpc.triggerExternalArtifactTestRestore.useMutation();
  const requestApproval = trpc.requestExternalArtifactRestoreApproval.useMutation();
  const [targetByArtifact, setTargetByArtifact] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const postgresTargets = useMemo(
    () =>
      policies.filter(
        (policy) => policy.backupType === "database" && policy.databaseEngine === "postgres"
      ),
    [policies]
  );

  async function handleVerify(artifactId: string) {
    setFeedback(null);
    try {
      const restore = await verifyArtifact.mutateAsync({ artifactId });
      setFeedback(`Queued isolated verification ${restore.id}.`);
      await artifacts.refetch();
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to queue isolated verification."
      );
    }
  }

  async function handleRequestRestore(artifactId: string) {
    const targetVolumeId = targetByArtifact[artifactId];
    if (!targetVolumeId) return;
    setFeedback(null);
    try {
      const request = await requestApproval.mutateAsync({
        artifactId,
        targetVolumeId,
        reason:
          "Restore a verified external PostgreSQL archive through the production approval gate."
      });
      setFeedback(`Requested production restore approval ${request.id}.`);
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to request production restore approval."
      );
    }
  }

  const rows = artifacts.data?.artifacts ?? [];

  if (!enabled || (!artifacts.isLoading && rows.length === 0)) return null;

  return (
    <Card data-testid="external-backup-artifacts">
      <CardHeader>
        <CardTitle className="text-base">External PostgreSQL archives</CardTitle>
        <p className="text-sm text-muted-foreground">
          Imported S3 objects stay separate from DaoFlow backup runs and cannot reach production
          until isolated verification and approval both succeed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback ? (
          <p
            className="rounded-md border bg-muted px-3 py-2 text-sm"
            data-testid="external-artifact-feedback"
          >
            {feedback}
          </p>
        ) : null}
        {artifacts.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading external archives…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Archive</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Identity</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((artifact) => {
                const targetVolumeId = targetByArtifact[artifact.id] ?? "";
                const canVerify = artifact.status === "registered";
                const canRequestRestore =
                  artifact.status === "verified" && Boolean(artifact.verifiedAt);
                return (
                  <TableRow key={artifact.id} data-testid={`external-artifact-${artifact.id}`}>
                    <TableCell className="max-w-[24rem]">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium" title={artifact.objectKey}>
                          {artifact.objectKey}
                        </span>
                        <Badge variant="secondary">External</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {artifact.destinationName} · {formatBytes(Number(artifact.sizeBytes))} ·
                        PostgreSQL {artifact.databaseEngineVersion ?? "pending"}
                      </div>
                      {artifact.error ? (
                        <div className="mt-1 text-xs text-destructive">{artifact.error}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getBackupOperationBadgeVariant(artifact.status)}>
                        {artifact.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[15rem] font-mono text-xs text-muted-foreground">
                      <div
                        className="truncate"
                        title={artifact.objectVersion ?? artifact.objectEtag ?? undefined}
                      >
                        {artifact.objectVersion ?? artifact.objectEtag}
                      </div>
                      <div className="truncate" title={artifact.sha256 ?? ""}>
                        {artifact.sha256 ?? "Checksum pending"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={targetVolumeId}
                        disabled={!canRequestRestore}
                        onValueChange={(value) =>
                          setTargetByArtifact((current) => ({
                            ...current,
                            [artifact.id]: value ?? ""
                          }))
                        }
                      >
                        <SelectTrigger
                          className="min-w-48"
                          aria-label={`Restore target for ${artifact.objectKey}`}
                          data-testid={`external-artifact-target-${artifact.id}`}
                        >
                          <SelectValue placeholder="Select PostgreSQL target" />
                        </SelectTrigger>
                        <SelectContent>
                          {postgresTargets.map((policy) => (
                            <SelectItem key={policy.volumeId} value={policy.volumeId}>
                              {policy.serviceName}@{policy.environmentName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      {canVerify ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={verifyArtifact.isPending}
                          onClick={() => void handleVerify(artifact.id)}
                          data-testid={`external-artifact-verify-${artifact.id}`}
                        >
                          Test restore
                        </Button>
                      ) : canRequestRestore ? (
                        <Button
                          size="sm"
                          disabled={!targetVolumeId || requestApproval.isPending}
                          onClick={() => void handleRequestRestore(artifact.id)}
                          data-testid={`external-artifact-request-restore-${artifact.id}`}
                        >
                          Request restore
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Waiting</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
