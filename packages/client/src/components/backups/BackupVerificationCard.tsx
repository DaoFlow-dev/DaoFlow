import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface VerificationCheck {
  status: "passed" | "failed" | "skipped";
  detail: string;
}

export interface BackupVerificationView {
  id: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  error: string | null;
  result: {
    success: boolean;
    checksum: string;
    sourceEngineVersion: string;
    verifierEngineVersion: string;
    durationMs: number;
    checks: Record<string, VerificationCheck>;
    objectCounts: {
      schemas: number;
      tables: number;
      indexes: number;
      functions: number;
    };
    cleanup: {
      containerRemoved: boolean;
      workspaceRemoved: boolean;
    };
  } | null;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function BackupVerificationCard({
  verification
}: {
  verification: BackupVerificationView | null;
}) {
  if (!verification) {
    return null;
  }

  const result = verification.result;

  return (
    <Card data-testid="backup-run-verification">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          Isolated restore verification
          <Badge variant={result?.success ? "default" : "secondary"}>{verification.status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Requested</p>
            <p>{formatDate(verification.requestedAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Completed</p>
            <p>{formatDate(verification.completedAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Duration</p>
            <p>{result ? `${Math.round(result.durationMs / 100) / 10}s` : "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Source engine</p>
            <p>{result?.sourceEngineVersion ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Verifier engine
            </p>
            <p>{result?.verifierEngineVersion ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Checksum</p>
            <p className="break-all font-mono text-xs">{result?.checksum ?? "—"}</p>
          </div>
        </div>

        {result ? (
          <div className="grid gap-2 md:grid-cols-2">
            {Object.entries(result.checks).map(([name, check]) => (
              <div className="rounded-lg border p-3" key={name}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{name}</span>
                  <Badge
                    variant={
                      check.status === "passed"
                        ? "default"
                        : check.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {check.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{check.detail}</p>
              </div>
            ))}
          </div>
        ) : null}

        {result ? (
          <p className="text-muted-foreground">
            Restored catalog: {result.objectCounts.schemas} schemas, {result.objectCounts.tables}{" "}
            tables, {result.objectCounts.indexes} indexes, and {result.objectCounts.functions}{" "}
            functions. Cleanup: container {result.cleanup.containerRemoved ? "removed" : "failed"},
            workspace {result.cleanup.workspaceRemoved ? "removed" : "failed"}.
          </p>
        ) : null}

        {verification.error ? <p className="text-destructive">{verification.error}</p> : null}
      </CardContent>
    </Card>
  );
}
