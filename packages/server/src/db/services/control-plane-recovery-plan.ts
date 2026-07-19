import { and, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { type ControlPlaneRecoveryCheck } from "../schema/control-plane-recovery";
import { backupDestinations } from "../schema/destinations";
import { resolveControlPlaneRecoveryKeyMetadata } from "./control-plane-recovery-key";
import { toControlPlaneRecoveryDestinationSummary } from "./control-plane-recovery-views";
import { nextMajorVersion } from "../../worker/temporal/activities/control-plane-recovery-safety";
import { isTemporalEnabled } from "../../worker/temporal/temporal-config";

const CONTROL_PLANE_RECOVERY_OBJECT_PREFIX = "control-plane-recovery/v1";
const DEFAULT_APP_VERSION = "0.11.0";

type DestinationRow = typeof backupDestinations.$inferSelect;

function applicationVersion(): string {
  return (
    process.env.DAOFLOW_APP_VERSION?.trim() ||
    process.env.DAOFLOW_VERSION?.trim() ||
    process.env.npm_package_version ||
    DEFAULT_APP_VERSION
  );
}

async function resolveSchemaMetadata(): Promise<{ version: string; available: boolean }> {
  const configured = process.env.DAOFLOW_SCHEMA_VERSION?.trim();
  if (configured) return { version: configured, available: true };

  try {
    const result = await db.execute<{ hash: string }>(sql`
      SELECT hash
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const version = result.rows[0]?.hash;
    return version ? { version, available: true } : { version: "untracked", available: false };
  } catch {
    return { version: "untracked", available: false };
  }
}

function requiredExternalSecrets(): string[] {
  const names = ["BETTER_AUTH_SECRET", "ENCRYPTION_KEY", "DAOFLOW_RECOVERY_ENCRYPTION_KEY"];
  if (process.env.DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY?.trim()) {
    names.push("DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY");
  }
  return names;
}

function hasUsableDestinationCredentials(destination: DestinationRow): boolean {
  return destination.provider === "local" || Boolean(destination.credentialsEncrypted);
}

function buildChecks(input: {
  destination: DestinationRow | null;
  keyError: boolean;
  schemaMetadataAvailable: boolean;
}): ControlPlaneRecoveryCheck[] {
  return [
    {
      status: input.destination ? "passed" : "failed",
      detail: input.destination
        ? "Destination belongs to the current owner team."
        : "Destination was not found for the current owner team."
    },
    {
      status:
        input.destination && hasUsableDestinationCredentials(input.destination)
          ? "passed"
          : "failed",
      detail:
        input.destination && hasUsableDestinationCredentials(input.destination)
          ? "Destination configuration is available without exposing credentials."
          : "Destination credentials are unavailable or require migration before recovery can run."
    },
    {
      status: process.env.DATABASE_URL?.trim() ? "passed" : "failed",
      detail: process.env.DATABASE_URL?.trim()
        ? "Control-plane database connection configuration is available."
        : "Control-plane database connection configuration is missing."
    },
    {
      status: input.schemaMetadataAvailable ? "passed" : "failed",
      detail: input.schemaMetadataAvailable
        ? "Database migration metadata is available for compatibility checks."
        : "Database migration metadata is unavailable; recovery cannot prove schema compatibility."
    },
    {
      status: input.keyError ? "failed" : "passed",
      detail: input.keyError
        ? "A separate recovery encryption key must be configured outside the database."
        : "Separate recovery encryption key metadata is available."
    },
    {
      status: isTemporalEnabled() ? "passed" : "failed",
      detail: isTemporalEnabled()
        ? "Temporal dispatch is enabled for recovery execution."
        : "Temporal dispatch must be enabled before a recovery bundle can run."
    }
  ];
}

function buildNextSteps(checks: ControlPlaneRecoveryCheck[]): string[] {
  const nextSteps: string[] = [];
  if (checks[0]?.status === "failed") {
    nextSteps.push("Choose a backup destination owned by the current team.");
  }
  if (checks[1]?.status === "failed") {
    nextSteps.push("Repair or migrate the destination credential configuration before retrying.");
  }
  if (checks[2]?.status === "failed") {
    nextSteps.push("Configure DATABASE_URL for the control-plane database.");
  }
  if (checks[3]?.status === "failed") {
    nextSteps.push("Restore the Drizzle migration journal before creating a recovery bundle.");
  }
  if (checks[4]?.status === "failed") {
    nextSteps.push(
      "Configure DAOFLOW_RECOVERY_ENCRYPTION_KEY in an external secret store, not in DaoFlow."
    );
  }
  if (checks[5]?.status === "failed") {
    nextSteps.push("Enable Temporal dispatch and ensure a recovery-capable worker is running.");
  }
  return nextSteps;
}

function recoveryObjectPathTemplate() {
  const prefix = `${CONTROL_PLANE_RECOVERY_OBJECT_PREFIX}/<bundle-id>`;
  return {
    prefix,
    bundlePath: `${prefix}/bundle.dfr`,
    manifestPath: `${prefix}/manifest.json`,
    latestManifestPath: `${CONTROL_PLANE_RECOVERY_OBJECT_PREFIX}/latest.json`
  };
}

export async function getControlPlaneRecoveryDestinationForOwner(
  destinationId: string,
  ownerTeamId: string
) {
  const [destination] = await db
    .select()
    .from(backupDestinations)
    .where(
      and(eq(backupDestinations.id, destinationId), eq(backupDestinations.teamId, ownerTeamId))
    )
    .limit(1);
  return destination ?? null;
}

export async function buildControlPlaneRecoveryPlan(input: {
  destinationId: string;
  ownerTeamId: string;
}) {
  const destination = await getControlPlaneRecoveryDestinationForOwner(
    input.destinationId,
    input.ownerTeamId
  );
  let keyMetadata: { fingerprint: string; rotatedAt: string | null } | null = null;
  try {
    keyMetadata = resolveControlPlaneRecoveryKeyMetadata();
  } catch {
    // Keep the plan safe and actionable without returning key configuration details.
  }

  const schemaMetadata = await resolveSchemaMetadata();
  const checks = buildChecks({
    destination,
    keyError: keyMetadata === null,
    schemaMetadataAvailable: schemaMetadata.available
  });
  const isReady = checks.every((check) => check.status === "passed");
  const nextSteps = buildNextSteps(checks);
  const appVersion = applicationVersion();
  const destinationSummary = toControlPlaneRecoveryDestinationSummary(destination);

  return {
    isReady,
    status: isReady ? "ready" : "blocked",
    destinationId: input.destinationId,
    destination: destinationSummary,
    destinationSummary,
    appVersion,
    schemaVersion: schemaMetadata.version,
    keyFingerprint: keyMetadata?.fingerprint ?? null,
    keyRotatedAt: keyMetadata?.rotatedAt ?? null,
    requiredExternalSecrets: requiredExternalSecrets(),
    checks,
    preflightChecks: checks,
    compatibility: {
      minimumAppVersion: appVersion,
      maximumAppVersionExclusive: nextMajorVersion(appVersion)
    },
    objectPrefix: CONTROL_PLANE_RECOVERY_OBJECT_PREFIX,
    objectPaths: recoveryObjectPathTemplate(),
    executeCommand: `daoflow backup recovery run --destination ${input.destinationId} --yes`,
    steps: [
      "Create a sanitized PostgreSQL logical dump.",
      "Encrypt the dump with the separate recovery key.",
      "Upload the bundle and discoverable signed sidecar manifest.",
      "Restore into an isolated PostgreSQL verifier and run integrity checks.",
      "Mark the bundle verified only after every required check passes."
    ],
    nextSteps,
    failureNextSteps: nextSteps,
    error: isReady ? null : "Control-plane recovery is not ready."
  };
}
