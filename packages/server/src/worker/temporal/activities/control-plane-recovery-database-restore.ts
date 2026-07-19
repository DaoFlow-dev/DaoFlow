import type {
  ControlPlaneRecoveryManifest,
  ControlPlaneRecoveryVerificationResult
} from "../../../db/schema/control-plane-recovery";
import type { ControlPlanePostgresSource } from "./control-plane-recovery-docker";
import {
  dockerCapture,
  dockerPipeFileToStdin,
  dockerWriteStdoutToFile
} from "./control-plane-recovery-docker-runner";
import {
  passed,
  readMigrationJournal,
  readObjectCounts,
  runVerifierSql,
  verifyEncryptedSecrets,
  verifyOwnership,
  verifySanitizedState,
  type RecoveryObjectCounts
} from "./control-plane-recovery-database-queries";
import {
  createRecoveryVerifierArgs,
  makeRecoveryVerificationContainer,
  removeRecoveryContainer,
  startAndWaitForRecoveryVerifier,
  type RecoveryVerificationContainer
} from "./control-plane-recovery-verifier";

const SANITIZATION_SQL = `
DO $$
BEGIN
  IF to_regclass('public.accounts') IS NOT NULL THEN
    UPDATE accounts SET access_token = NULL, refresh_token = NULL, id_token = NULL;
  END IF;
  IF to_regclass('public.backup_destinations') IS NOT NULL THEN
    UPDATE backup_destinations
    SET access_key = NULL, secret_access_key = NULL, rclone_config = NULL,
        oauth_token = NULL, oauth_token_expiry = NULL, encryption_password = NULL, encryption_salt = NULL;
  END IF;
  IF to_regclass('public.git_providers') IS NOT NULL THEN UPDATE git_providers SET webhook_secret = NULL; END IF;
  IF to_regclass('public.notification_channels') IS NOT NULL THEN
    UPDATE notification_channels SET webhook_url = NULL, enabled = false WHERE webhook_url IS NOT NULL;
  END IF;
  IF to_regclass('public.notification_logs') IS NOT NULL THEN DELETE FROM notification_logs; END IF;
  IF to_regclass('public.push_subscriptions') IS NOT NULL THEN DELETE FROM push_subscriptions; END IF;
  IF to_regclass('public.sessions') IS NOT NULL THEN DELETE FROM sessions; END IF;
  IF to_regclass('public.verifications') IS NOT NULL THEN DELETE FROM verifications; END IF;
  IF to_regclass('public.two_factor') IS NOT NULL THEN DELETE FROM two_factor; END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    UPDATE users SET two_factor_enabled = false, mfa_enrolled_at = NULL;
  END IF;
  IF to_regclass('public.cli_auth_requests') IS NOT NULL THEN DELETE FROM cli_auth_requests; END IF;
  IF to_regclass('public.git_provider_setup_states') IS NOT NULL THEN DELETE FROM git_provider_setup_states; END IF;
END $$;`;

export interface ControlPlaneRecoveryDumpEvidence {
  migrations: ControlPlaneRecoveryManifest["migrations"];
  objectCounts: RecoveryObjectCounts;
}

export async function dumpControlPlane(
  source: ControlPlanePostgresSource,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  await dockerWriteStdoutToFile(
    [
      "exec",
      source.containerName,
      "pg_dump",
      "--format=custom",
      "--compress=6",
      "--no-owner",
      "--no-privileges",
      "--serializable-deferrable",
      "--username",
      source.databaseUser,
      "--dbname",
      source.databaseName
    ],
    outputPath,
    "dump the control-plane database",
    signal
  );
}

export async function createSanitizedControlPlaneDump(input: {
  bundleId: string;
  verifierImage: string;
  sourceDumpPath: string;
  sanitizedDumpPath: string;
  cancellationSignal?: AbortSignal;
}): Promise<ControlPlaneRecoveryDumpEvidence> {
  return withRecoveryVerifier(
    input.bundleId,
    "prepare",
    input.verifierImage,
    input.cancellationSignal,
    async (container) => {
      await restoreDump(container, input.sourceDumpPath, input.cancellationSignal);
      const [migrations, objectCounts] = await Promise.all([
        readMigrationJournal(container, input.cancellationSignal),
        readObjectCounts(container, input.cancellationSignal)
      ]);
      await runVerifierSql(
        container,
        SANITIZATION_SQL,
        "sanitize control-plane recovery data",
        input.cancellationSignal
      );
      await redumpVerifier(container, input.sanitizedDumpPath, input.cancellationSignal);
      return { migrations, objectCounts };
    }
  );
}

export async function verifySanitizedControlPlaneDump(input: {
  bundleId: string;
  verifierImage: string;
  sanitizedDumpPath: string;
  expectedMigrations: ControlPlaneRecoveryManifest["migrations"];
  expectedCounts: RecoveryObjectCounts;
  cancellationSignal?: AbortSignal;
}): Promise<{
  checks: ControlPlaneRecoveryVerificationResult["checks"];
  objectCounts: RecoveryObjectCounts;
}> {
  return withRecoveryVerifier(
    input.bundleId,
    "verify",
    input.verifierImage,
    input.cancellationSignal,
    async (container) => {
      await dockerPipeFileToStdin(
        ["exec", "--interactive", container.name, "pg_restore", "--format=custom", "--list"],
        input.sanitizedDumpPath,
        "inspect the final sanitized custom dump",
        input.cancellationSignal
      );
      await restoreDump(container, input.sanitizedDumpPath, input.cancellationSignal);
      const [migrations, objectCounts, secretCheck] = await Promise.all([
        readMigrationJournal(container, input.cancellationSignal),
        readObjectCounts(container, input.cancellationSignal),
        verifyEncryptedSecrets(container, input.cancellationSignal),
        verifyOwnership(container, input.cancellationSignal),
        verifySanitizedState(container, input.cancellationSignal)
      ]);
      if (JSON.stringify(migrations.applied) !== JSON.stringify(input.expectedMigrations.applied)) {
        throw new Error(
          "Sanitized recovery dump migration journal does not match the restored source dump."
        );
      }
      if (JSON.stringify(objectCounts) !== JSON.stringify(input.expectedCounts)) {
        throw new Error(
          "Sanitized recovery dump object counts do not match the restored source dump."
        );
      }
      return {
        objectCounts,
        checks: {
          archive: passed(
            "Final sanitized PostgreSQL custom archive listed and secret-field checks passed."
          ),
          restore: passed("Final sanitized dump restored in a disposable no-network verifier."),
          migrations: passed("Migration journal matches the restored source dump."),
          ownership: passed("Team and ownership relationships are intact."),
          secretDecryptability: secretCheck,
          remoteRoundTrip: { status: "skipped", detail: "Remote round-trip has not run yet." }
        }
      };
    }
  );
}

async function withRecoveryVerifier<T>(
  bundleId: string,
  suffix: "prepare" | "verify",
  image: string,
  signal: AbortSignal | undefined,
  operation: (container: RecoveryVerificationContainer) => Promise<T>
): Promise<T> {
  const container = makeRecoveryVerificationContainer(bundleId, suffix);
  let created = false;
  let operationError: unknown;
  let result: T | undefined;
  try {
    await removeRecoveryContainer(container.name);
    await dockerCapture(
      createRecoveryVerifierArgs(image, container, bundleId),
      "create isolated recovery verifier container",
      signal
    );
    created = true;
    await startAndWaitForRecoveryVerifier(container, signal);
    result = await operation(container);
  } catch (error) {
    operationError = error;
  }
  const removed = created ? await removeRecoveryContainer(container.name) : true;
  if (!removed) throw new Error("Recovery verifier container cleanup failed.");
  if (operationError) {
    throw operationError instanceof Error
      ? operationError
      : new Error("Recovery verifier operation failed.");
  }
  return result as T;
}

async function restoreDump(
  container: RecoveryVerificationContainer,
  dumpPath: string,
  signal?: AbortSignal
): Promise<void> {
  await dockerPipeFileToStdin(
    [
      "exec",
      "--interactive",
      container.name,
      "pg_restore",
      "--format=custom",
      "--exit-on-error",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--username",
      container.databaseUser,
      "--dbname",
      container.databaseName
    ],
    dumpPath,
    "restore the control-plane dump in an isolated verifier",
    signal
  );
}

async function redumpVerifier(
  container: RecoveryVerificationContainer,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  await dockerWriteStdoutToFile(
    [
      "exec",
      container.name,
      "pg_dump",
      "--format=custom",
      "--compress=6",
      "--no-owner",
      "--no-privileges",
      "--username",
      container.databaseUser,
      "--dbname",
      container.databaseName
    ],
    outputPath,
    "create the sanitized control-plane dump",
    signal
  );
}
