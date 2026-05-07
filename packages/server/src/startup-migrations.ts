import { markStartupCheck } from "./startup-readiness";
import { runAutoMigrations } from "./db/auto-migrate";

export type StartupMigrationOptions = {
  isProduction: boolean;
  allowFailure?: boolean;
  runMigrations?: () => Promise<void>;
};

export function shouldAllowMigrationFailure() {
  return process.env.DAOFLOW_ALLOW_START_WITH_MIGRATION_FAILURE === "true";
}

export async function runStartupMigrations(input: StartupMigrationOptions) {
  const runMigrations = input.runMigrations ?? runAutoMigrations;
  const allowFailure = input.allowFailure ?? shouldAllowMigrationFailure();

  markStartupCheck("migrations", "pending", "Database migrations are running.");

  try {
    await runMigrations();
    markStartupCheck("migrations", "ok", "Database migrations completed.");
  } catch (error) {
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
}
