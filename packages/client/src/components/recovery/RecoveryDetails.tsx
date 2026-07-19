import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  RecoveryBundle,
  RecoveryMetadata,
  RecoveryPlan,
  RecoveryVerification
} from "@/features/recovery/types";

type RecoveryRecord = RecoveryPlan | RecoveryBundle | RecoveryMetadata;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function statusVariant(status: string): "success" | "destructive" | "secondary" | "outline" {
  if (["verified", "passed", "ready", "success", "succeeded"].includes(status)) return "success";
  if (["failed", "not-ready", "not ready", "error"].includes(status)) return "destructive";
  if (["queued", "running", "pending"].includes(status)) return "secondary";
  return "outline";
}

function getDestination(data: RecoveryRecord): string {
  const record = asRecord(data);
  const destination = asRecord(record.destination ?? record.destinationSummary);
  return text(destination.name ?? record.destinationName ?? record.destinationId);
}

function getFingerprint(data: RecoveryRecord): string {
  const record = asRecord(data);
  const manifest = asRecord(record.manifest);
  const recoveryKey = asRecord(record.recoveryKey ?? manifest.recoveryKey);
  return text(record.keyFingerprint ?? recoveryKey.fingerprint);
}

function getChecks(data: RecoveryRecord): Array<{ status: string; detail: string }> {
  const record = asRecord(data);
  const checks = Array.isArray(record.checks)
    ? record.checks
    : Array.isArray(record.preflightChecks)
      ? record.preflightChecks
      : [];
  return checks.flatMap((check) => {
    const item = asRecord(check);
    return typeof item.detail === "string"
      ? [{ status: text(item.status, "unknown"), detail: item.detail }]
      : [];
  });
}

function getVerification(data: RecoveryRecord): RecoveryVerification | null {
  const record = asRecord(data);
  const verification = record.verification ?? record.verificationResult;
  return verification && typeof verification === "object"
    ? (verification as RecoveryVerification)
    : null;
}

function getObjectPaths(data: RecoveryRecord): Record<string, string> {
  const record = asRecord(data);
  const manifest = asRecord(record.manifest);
  const paths = record.objectPaths ?? record.objects ?? manifest.objects;
  if (typeof paths === "object" && paths !== null && !Array.isArray(paths)) {
    return Object.fromEntries(
      Object.entries(paths).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  }
  return Object.fromEntries(
    [
      ["bundle", record.bundleObjectPath],
      ["manifest", record.manifestObjectPath],
      ["latestManifest", record.latestManifestObjectPath]
    ].filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function getNextSteps(data: RecoveryRecord): string[] {
  const record = asRecord(data);
  const nextSteps = record.failureNextSteps ?? record.nextSteps ?? record.recommendedActions;
  return Array.isArray(nextSteps)
    ? nextSteps.filter((step): step is string => typeof step === "string")
    : [];
}

function VerificationEvidence({ verification }: { verification: RecoveryVerification | null }) {
  if (!verification) {
    return <p data-testid="recovery-verification-status">Verification pending.</p>;
  }

  const success = verification.success;
  const status =
    success === true
      ? "passed"
      : success === false
        ? "failed"
        : text(verification.status, "pending");
  const checks = verification.checks ?? {};

  return (
    <div className="flex flex-col gap-2" data-testid="recovery-verification">
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant(status)} data-testid="recovery-verification-status">
          {status}
        </Badge>
        {verification.completedAt ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="recovery-verification-completed-at"
          >
            {verification.completedAt}
          </span>
        ) : null}
      </div>
      {Object.entries(checks).length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="recovery-verification-checks">
          {Object.entries(checks).map(([name, check]) => (
            <li key={name} data-testid={`recovery-verification-check-${name}`}>
              <span className="font-medium">{name}:</span> {text(check.status, "unknown")} —{" "}
              {text(check.detail, "No detail")}
            </li>
          ))}
        </ul>
      ) : null}
      {verification.error ? (
        <p className="text-sm text-destructive" data-testid="recovery-verification-error">
          {verification.error}
        </p>
      ) : null}
    </div>
  );
}

export function RecoveryDetails({ data, title }: { data: RecoveryRecord; title: string }) {
  const record = asRecord(data);
  const readiness =
    record.isReady === true
      ? "ready"
      : record.isReady === false
        ? "not ready"
        : text(record.status, "unknown");
  const checks = getChecks(data);
  const paths = getObjectPaths(data);
  const nextSteps = getNextSteps(data);
  const requiredSecrets = Array.isArray(record.requiredExternalSecrets)
    ? record.requiredExternalSecrets.filter((name): name is string => typeof name === "string")
    : Array.isArray(asRecord(record.manifest).requiredExternalSecrets)
      ? (asRecord(record.manifest).requiredExternalSecrets as unknown[]).filter(
          (name): name is string => typeof name === "string"
        )
      : [];

  return (
    <Card data-testid="recovery-details">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base" data-testid="recovery-details-title">
            {title}
          </CardTitle>
          <Badge variant={statusVariant(readiness)} data-testid="recovery-readiness-status">
            {readiness}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div data-testid="recovery-destination">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Destination</dt>
            <dd className="mt-1 font-medium">{getDestination(data)}</dd>
          </div>
          <div data-testid="recovery-key-fingerprint">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Key fingerprint
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">{getFingerprint(data)}</dd>
          </div>
          <div data-testid="recovery-app-version">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">App version</dt>
            <dd className="mt-1">{text(record.appVersion)}</dd>
          </div>
          <div data-testid="recovery-schema-version">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Schema version
            </dt>
            <dd className="mt-1">{text(record.schemaVersion)}</dd>
          </div>
        </dl>

        {checks.length > 0 ? (
          <section className="flex flex-col gap-2" data-testid="recovery-readiness-checks">
            <h3 className="font-medium">Readiness checks</h3>
            <ul className="flex flex-col gap-1">
              {checks.map((check, index) => (
                <li key={`${check.detail}-${index}`} data-testid={`recovery-check-${index}`}>
                  <span className="font-medium">{check.status}:</span> {check.detail}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {requiredSecrets.length > 0 ? (
          <section className="flex flex-col gap-2" data-testid="recovery-required-secrets">
            <h3 className="font-medium">Required external secrets</h3>
            <p className="text-muted-foreground">Names only; values are never displayed here.</p>
            <ul className="flex flex-wrap gap-2">
              {requiredSecrets.map((secret) => (
                <li key={secret} data-testid={`recovery-secret-${secret}`}>
                  <Badge variant="outline">{secret}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {Object.keys(paths).length > 0 ? (
          <section className="flex flex-col gap-2" data-testid="recovery-object-paths">
            <h3 className="font-medium">Object paths</h3>
            <dl className="flex flex-col gap-1">
              {Object.entries(paths).map(([name, path]) => (
                <div
                  key={name}
                  className="grid gap-1 sm:grid-cols-[9rem_1fr]"
                  data-testid={`recovery-object-path-${name}`}
                >
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="break-all font-mono text-xs">{path}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section className="flex flex-col gap-2" data-testid="recovery-verification-evidence">
          <h3 className="font-medium">Verification evidence</h3>
          <VerificationEvidence verification={getVerification(data)} />
        </section>

        {record.error || nextSteps.length > 0 ? (
          <section className="flex flex-col gap-2" data-testid="recovery-failure-next-steps">
            <h3 className="font-medium text-destructive">Failure next steps</h3>
            {record.error ? <p data-testid="recovery-error">{text(record.error)}</p> : null}
            {nextSteps.length > 0 ? (
              <ol className="list-decimal pl-5">
                {nextSteps.map((step, index) => (
                  <li key={`${step}-${index}`} data-testid={`recovery-next-step-${index}`}>
                    {step}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
