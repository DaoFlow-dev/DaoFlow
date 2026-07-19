import chalk from "chalk";
import type {
  ControlPlaneRecoveryBundleOutput,
  ControlPlaneRecoveryBundlesOutput
} from "../trpc-contract";

const SENSITIVE_KEYS = new Set([
  "key",
  "keymaterial",
  "rawkey",
  "encryptionkey",
  "privatekey",
  "sshprivatekey",
  "secret",
  "secretvalue",
  "secretaccesskey",
  "credential",
  "credentials",
  "password",
  "token"
]);
const SENSITIVE_TEXT_PATTERN =
  /(?:password|secret|token|credential|private\s*key|key\s*material)\s*[:=]\s*\S+/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[A-Z]/g, (letter) => letter.toLowerCase()).replace(/[-_]/g, "");
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.includes("privatekey") ||
    normalized.includes("secretvalue") ||
    normalized.includes("keymaterial")
  );
}

/** Keep the CLI boundary safe if a future API response accidentally adds a credential field. */
export function safePayload<T>(value: T): T {
  if (typeof value === "string") {
    return (SENSITIVE_TEXT_PATTERN.test(value) ? "Sensitive detail redacted." : value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => safePayload(item)) as unknown as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, nestedValue]) => [key, safePayload(nestedValue)])
  ) as T;
}

export function getRecoveryBundleId(value: unknown): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : "";
}

function valueAt(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    return isRecord(value) ? value[key] : undefined;
  }, record);
}

function firstString(record: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = valueAt(record, path);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function renderChecks(record: Record<string, unknown>): void {
  const checks = Array.isArray(record.checks)
    ? record.checks
    : Array.isArray(record.preflightChecks)
      ? record.preflightChecks
      : [];

  if (checks.length === 0) return;

  console.log(chalk.dim("  Readiness checks:"));
  for (const check of checks) {
    if (!isRecord(check)) continue;
    const status = text(check.status, "unknown");
    const marker =
      status === "passed" || status === "ok"
        ? chalk.green("✓")
        : status === "failed" || status === "fail"
          ? chalk.red("✗")
          : chalk.yellow("!");
    console.log(`    ${marker} ${text(check.detail, status)}`);
  }
}

function renderObjectPaths(record: Record<string, unknown>): void {
  const paths = isRecord(record.objectPaths)
    ? record.objectPaths
    : isRecord(record.objects)
      ? record.objects
      : {
          bundle: record.bundleObjectPath,
          manifest: record.manifestObjectPath,
          latestManifest: record.latestManifestObjectPath
        };
  const entries = Object.entries(paths).filter(([, value]) => typeof value === "string");
  if (entries.length === 0) return;

  console.log(chalk.dim("  Object paths:"));
  for (const [name, path] of entries) console.log(`    ${name}: ${String(path)}`);
}

function renderVerification(record: Record<string, unknown>): void {
  const verification = isRecord(record.verification)
    ? record.verification
    : isRecord(record.verificationResult)
      ? record.verificationResult
      : null;
  if (!verification) {
    console.log("  Verification: pending");
    return;
  }

  const success = verification.success;
  const status =
    success === true
      ? chalk.green("passed")
      : success === false
        ? chalk.red("failed")
        : text(verification.status, "pending");
  console.log(`  Verification: ${status}`);
  if (typeof verification.completedAt === "string") {
    console.log(`  Verified at: ${verification.completedAt}`);
  }

  if (isRecord(verification.checks)) {
    console.log(chalk.dim("  Verification evidence:"));
    for (const [name, check] of Object.entries(verification.checks)) {
      if (!isRecord(check)) continue;
      console.log(`    ${name}: ${text(check.status, "unknown")} — ${text(check.detail, "")}`);
    }
  }
}

export function renderRecoveryDetails(title: string, data: unknown): void {
  const record = isRecord(data) ? data : {};
  const ready = record.isReady;
  const status = text(
    record.status,
    ready === true ? "ready" : ready === false ? "not ready" : "unknown"
  );
  const destination = firstString(record, [
    "destination.name",
    "destinationSummary.name",
    "destinationName",
    "destinationId"
  ]);
  const fingerprint = firstString(record, [
    "keyFingerprint",
    "recoveryKey.fingerprint",
    "manifest.recoveryKey.fingerprint"
  ]);

  console.log(chalk.bold(`\n  ${title}\n`));
  console.log(
    `  Readiness: ${ready === true ? chalk.green("ready") : ready === false ? chalk.red("not ready") : status}`
  );
  if (record.id || record.bundleId)
    console.log(`  Bundle:    ${String(record.id ?? record.bundleId)}`);
  if (destination) console.log(`  Destination: ${destination}`);
  if (fingerprint) console.log(`  Key fingerprint: ${fingerprint}`);
  if (record.appVersion) console.log(`  App version: ${text(record.appVersion, "unknown")}`);
  if (record.schemaVersion) {
    console.log(`  Schema version: ${text(record.schemaVersion, "unknown")}`);
  }
  if (record.requiredExternalSecrets) {
    console.log(
      `  Required external secrets: ${stringList(record.requiredExternalSecrets).join(", ") || "none"}`
    );
  }
  renderChecks(record);
  renderObjectPaths(record);
  renderVerification(record);

  const nextSteps = stringList(
    record.failureNextSteps ?? record.nextSteps ?? record.recommendedActions
  );
  if (record.error || nextSteps.length > 0) {
    console.log(chalk.dim("  Failure next steps:"));
    if (typeof record.error === "string") console.log(`    ${record.error}`);
    for (const step of nextSteps) console.log(`    - ${step}`);
  }
  console.log("");
}

export function renderRecoveryList(
  data: ControlPlaneRecoveryBundlesOutput | ControlPlaneRecoveryBundleOutput[]
): void {
  const bundles = Array.isArray(data) ? data : data.bundles;
  console.log(chalk.bold("\n  Control-plane recovery bundles\n"));
  if (bundles.length === 0) {
    console.log(chalk.dim("  No recovery bundles found.\n"));
    return;
  }
  for (const bundle of bundles) {
    const destination = firstString(bundle, [
      "destination.name",
      "destinationSummary.name",
      "destinationId"
    ]);
    console.log(`  ${bundle.id}  ${bundle.status}  ${destination ?? "destination unavailable"}`);
    if (bundle.createdAt) console.log(chalk.dim(`    Created: ${bundle.createdAt}`));
    if (bundle.error) console.log(chalk.red(`    Failure: ${bundle.error}`));
  }
  console.log("");
}
