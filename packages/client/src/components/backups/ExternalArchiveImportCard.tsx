import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { DatabaseBackup } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { formatBytes } from "@/lib/tone-utils";

interface ExternalArchiveImportCardProps {
  destinationId: string;
  enabled: boolean;
  approvedPrefix: string | null;
  maxBytes: number;
}

export function ExternalArchiveImportCard({
  destinationId,
  enabled,
  approvedPrefix,
  maxBytes
}: ExternalArchiveImportCardProps) {
  const [objectKey, setObjectKey] = useState("");
  const [postgresMajor, setPostgresMajor] = useState("17");
  const [feedback, setFeedback] = useState<string | null>(null);
  const objects = trpc.externalBackupObjects.useQuery(
    { destinationId },
    { enabled: Boolean(destinationId) && enabled }
  );
  const registerArtifact = trpc.registerExternalBackupArtifact.useMutation();

  async function registerObject(key: string) {
    setFeedback(null);
    try {
      const result = await registerArtifact.mutateAsync({
        destinationId,
        objectKey: key,
        postgresMajor: Number(postgresMajor)
      });
      setObjectKey(key);
      setFeedback(
        `Registered ${result.artifact.id}. Validation is running before test restore becomes available.`
      );
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to register this PostgreSQL archive."
      );
    }
  }

  return (
    <Card data-testid="external-archive-import-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseBackup size={17} /> Import an existing PostgreSQL archive
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          DaoFlow pins the exact S3 object, streams and inspects the custom-format archive, then
          requires an isolated test restore before production approval.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
            Existing archive imports are disabled for this destination. Create or update an S3
            destination with an approved import prefix first.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="external-archive-key">Exact object key</Label>
                <Input
                  id="external-archive-key"
                  data-testid="external-archive-key"
                  placeholder={approvedPrefix ?? "database-imports/db.dump"}
                  value={objectKey}
                  onChange={(event) => setObjectKey(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="external-archive-postgres-major">PostgreSQL major</Label>
                <Input
                  id="external-archive-postgres-major"
                  data-testid="external-archive-postgres-major"
                  inputMode="numeric"
                  value={postgresMajor}
                  onChange={(event) => setPostgresMajor(event.target.value)}
                />
              </div>
              <Button
                data-testid="external-archive-register"
                disabled={
                  registerArtifact.isPending ||
                  objectKey.trim().length === 0 ||
                  !/^\d+$/.test(postgresMajor)
                }
                onClick={() => void registerObject(objectKey.trim())}
              >
                {registerArtifact.isPending ? "Registering…" : "Register archive"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Approved prefix: /{approvedPrefix} · Maximum size: {formatBytes(maxBytes)}
            </p>
            {objects.data?.objects.length ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Objects under the approved prefix
                </p>
                {objects.data.objects.slice(0, 12).map((object) => (
                  <div
                    className="flex items-center justify-between gap-3 text-sm"
                    key={`${object.key}:${object.versionId ?? object.etag}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={object.key}>
                        {object.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(object.size)} ·{" "}
                        {object.lastModified
                          ? new Date(object.lastModified).toLocaleString()
                          : "Modified time unavailable"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={registerArtifact.isPending}
                      data-testid={`external-archive-select-${object.key}`}
                      onClick={() => {
                        setObjectKey(object.key);
                        void registerObject(object.key);
                      }}
                    >
                      Import
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
        {feedback ? (
          <p
            className="rounded-md border bg-muted px-3 py-2 text-sm"
            data-testid="external-archive-feedback"
          >
            {feedback}{" "}
            {feedback.startsWith("Registered") ? (
              <Link className="font-medium text-primary hover:underline" to="/backups">
                View external archives
              </Link>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
