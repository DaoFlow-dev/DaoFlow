import { markStartupCheck } from "./startup-readiness";
import { runAutoMigrations } from "./db/auto-migrate";
import {
  migrateBackupDestinationCredentials,
  type DestinationCredentialMigrationReport
} from "./db/services/destination-credential-migration";

export type StartupMigrationOptions = {
  isProduction: boolean;
  allowFailure?: boolean;
  runMigrations?: () => Promise<void>;
  runCredentialMigration?: () => Promise<DestinationCredentialMigrationReport>;
};

export function shouldAllowMigrationFailure() {
  return process.env.DAOFLOW_ALLOW_START_WITH_MIGRATION_FAILURE === "true";
}

export async function runStartupMigrations(input: StartupMigrationOptions) {
  const runMigrations = input.runMigrations ?? runAutoMigrations;
  const runCredentialMigration =
    input.runCredentialMigration ?? migrateBackupDestinationCredentials;
  const allowFailure = input.allowFailure ?? shouldAllowMigrationFailure();

  markStartupCheck("migrations", "pending", "Database migrations are running.");

  let schemaMigrationFailed = false;
  try {
    await runMigrations();
  } catch (error) {
    schemaMigrationFailed = true;
    const message = error instanceof Error ? error.message : String(error);
    markStartupCheck("migrations", "failed", `Database migrations failed: ${message}`);

    if (input.isProduction && !allowFailure) {
      throw error;
    }

    console.error("[migrate] Auto-migration failed:", message);
    console.warn(
      "[migrate] Continuing because production fail-fast is disabled or this is not production."
    );
  }

  try {
    const report = await runCredentialMigration();
    if (!schemaMigrationFailed) {
      markStartupCheck(
        "migrations",
        "ok",
        `Database migrations completed. Backup-destination credentials: ${report.migrated} migrated, ${report.rotated} rotated, ${report.verified} verified.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markStartupCheck(
      "migrations",
      "failed",
      `Backup-destination credential migration failed: ${message}`
    );

    if (input.isProduction) {
      throw error;
    }

    console.error("[migrate] Backup-destination credential migration failed:", message);
    console.warn("[migrate] Continuing outside production with backup destinations unavailable.");
  }
}
