import { decryptWithKeyMaterial, resolveEncryptionKeyMaterial } from "../../../db/crypto";
import type {
  ControlPlaneRecoveryCheck,
  ControlPlaneRecoveryManifest,
  ControlPlaneRecoveryMigrationEntry,
  ControlPlaneRecoveryVerificationResult
} from "../../../db/schema/control-plane-recovery";
import { decryptDestinationCredentials } from "../../../db/services/destination-credentials";
import { dockerCapture } from "./control-plane-recovery-docker-runner";
import type { ControlPlanePostgresSource } from "./control-plane-recovery-docker";
import type { RecoveryVerificationContainer } from "./control-plane-recovery-verifier";

const MIGRATION_JOURNAL_SQL =
  "SELECT COALESCE(json_agg(json_build_object('hash', hash, 'createdAt', created_at) ORDER BY created_at), '[]'::json)::text FROM drizzle.__drizzle_migrations;";
const OBJECT_COUNTS_SQL =
  "SELECT json_build_object('teams', (SELECT count(*)::int FROM teams), 'users', (SELECT count(*)::int FROM users), 'projects', (SELECT count(*)::int FROM projects), 'servers', (SELECT count(*)::int FROM servers), 'auditEntries', (SELECT count(*)::int FROM audit_entries), 'backupRuns', (SELECT count(*)::int FROM backup_runs))::text;";
const OWNERSHIP_SQL =
  "SELECT json_build_object('teamMembersWithoutTeam', (SELECT count(*)::int FROM team_members member LEFT JOIN teams team ON team.id = member.team_id WHERE team.id IS NULL), 'teamMembersWithoutUser', (SELECT count(*)::int FROM team_members member LEFT JOIN users usr ON usr.id = member.user_id WHERE usr.id IS NULL), 'projectsWithoutTeam', (SELECT count(*)::int FROM projects project LEFT JOIN teams team ON team.id = project.team_id WHERE team.id IS NULL), 'serversWithMissingTeam', (SELECT count(*)::int FROM servers server LEFT JOIN teams team ON team.id = server.team_id WHERE server.team_id IS NOT NULL AND team.id IS NULL), 'teamCreatorsWithoutUser', (SELECT count(*)::int FROM teams team LEFT JOIN users usr ON usr.id = team.created_by_user_id WHERE team.created_by_user_id IS NOT NULL AND usr.id IS NULL))::text;";
const SANITIZED_STATE_SQL =
  "SELECT json_build_object('accountTokens', (SELECT count(*)::int FROM accounts WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR id_token IS NOT NULL), 'destinationPlaintextCredentials', (SELECT count(*)::int FROM backup_destinations WHERE access_key IS NOT NULL OR secret_access_key IS NOT NULL OR rclone_config IS NOT NULL OR oauth_token IS NOT NULL OR encryption_password IS NOT NULL OR encryption_salt IS NOT NULL), 'gitWebhookSecrets', (SELECT count(*)::int FROM git_providers WHERE webhook_secret IS NOT NULL), 'notificationWebhookUrls', (SELECT count(*)::int FROM notification_channels WHERE webhook_url IS NOT NULL), 'notificationLogs', (SELECT count(*)::int FROM notification_logs), 'pushSubscriptions', (SELECT count(*)::int FROM push_subscriptions), 'sessions', (SELECT count(*)::int FROM sessions), 'verifications', (SELECT count(*)::int FROM verifications), 'twoFactorSecrets', (SELECT count(*)::int FROM two_factor), 'usersWithMfaState', (SELECT count(*)::int FROM users WHERE two_factor_enabled OR mfa_enrolled_at IS NOT NULL), 'cliAuthRequests', (SELECT count(*)::int FROM cli_auth_requests), 'gitProviderSetupStates', (SELECT count(*)::int FROM git_provider_setup_states))::text;";
const ENCRYPTED_SECRET_SQL =
  "SELECT json_build_object('application', COALESCE((SELECT value_encrypted FROM environment_variables WHERE value_encrypted IS NOT NULL LIMIT 1), (SELECT value_encrypted FROM service_variables WHERE value_encrypted IS NOT NULL LIMIT 1), (SELECT private_key_encrypted FROM managed_ssh_keys WHERE private_key_encrypted IS NOT NULL LIMIT 1)), 'destination', (SELECT json_build_object('credentialsEncrypted', credentials_encrypted, 'credentialEnvelopeVersion', credential_envelope_version, 'credentialKeyId', credential_key_id) FROM backup_destinations WHERE credentials_encrypted IS NOT NULL LIMIT 1))::text;";

export type RecoveryPostgresTarget = ControlPlanePostgresSource | RecoveryVerificationContainer;
export type RecoveryObjectCounts = ControlPlaneRecoveryVerificationResult["objectCounts"];

export async function readMigrationJournal(
  target: RecoveryPostgresTarget,
  signal?: AbortSignal
): Promise<ControlPlaneRecoveryManifest["migrations"]> {
  const applied = parseMigrations(
    await psql(target, MIGRATION_JOURNAL_SQL, "read migration journal", signal)
  );
  return { count: applied.length, latestHash: applied.at(-1)?.hash ?? null, applied };
}

export async function readObjectCounts(
  target: RecoveryPostgresTarget,
  signal?: AbortSignal
): Promise<RecoveryObjectCounts> {
  return parseCounts(await psql(target, OBJECT_COUNTS_SQL, "count control-plane objects", signal));
}

export async function verifyOwnership(
  target: RecoveryVerificationContainer,
  signal?: AbortSignal
): Promise<void> {
  const result = parseNumberRecord(
    await psql(target, OWNERSHIP_SQL, "verify ownership relationships", signal)
  );
  if (Object.values(result).some((count) => count !== 0)) {
    throw new Error("Sanitized recovery dump has invalid owner or team relationships.");
  }
}

export async function verifySanitizedState(
  target: RecoveryVerificationContainer,
  signal?: AbortSignal
): Promise<void> {
  const result = parseNumberRecord(
    await psql(target, SANITIZED_STATE_SQL, "verify recovery secret sanitization", signal)
  );
  if (Object.values(result).some((count) => count !== 0)) {
    throw new Error("Sanitized recovery dump still contains ephemeral or plaintext secret data.");
  }
}

export async function verifyEncryptedSecrets(
  target: RecoveryVerificationContainer,
  signal?: AbortSignal
): Promise<ControlPlaneRecoveryCheck> {
  const value = JSON.parse(
    await psql(target, ENCRYPTED_SECRET_SQL, "read encrypted recovery verification samples", signal)
  ) as { application: string | null; destination: unknown };
  if (typeof value.application === "string") {
    decryptWithKeyMaterial(value.application, resolveEncryptionKeyMaterial());
  }
  if (value.destination !== null && value.destination !== undefined) {
    decryptDestinationCredentials(
      value.destination as {
        credentialsEncrypted: string | null;
        credentialEnvelopeVersion: number | null;
        credentialKeyId: string | null;
      }
    );
  }
  return typeof value.application === "string" || value.destination
    ? passed("Representative encrypted values decrypted with configured keys.")
    : passed("No encrypted secret values were present, so no stored ciphertext required a key.");
}

export async function runVerifierSql(
  container: RecoveryVerificationContainer,
  sql: string,
  operation: string,
  signal?: AbortSignal
): Promise<void> {
  await psql(container, sql, operation, signal);
}

export function passed(detail: string): ControlPlaneRecoveryCheck {
  return { status: "passed", detail };
}

async function psql(
  target: RecoveryPostgresTarget,
  sql: string,
  operation: string,
  signal?: AbortSignal
): Promise<string> {
  const containerName = "containerName" in target ? target.containerName : target.name;
  return (
    await dockerCapture(
      [
        "exec",
        containerName,
        "psql",
        "--username",
        target.databaseUser,
        "--dbname",
        target.databaseName,
        "--tuples-only",
        "--no-align",
        "--quiet",
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--command",
        sql
      ],
      operation,
      signal
    )
  ).trim();
}

function parseMigrations(serialized: string): ControlPlaneRecoveryMigrationEntry[] {
  const value = JSON.parse(serialized) as unknown;
  if (!Array.isArray(value)) throw new Error("Control-plane migration journal is invalid.");
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as Record<string, unknown>).hash !== "string" ||
      !Number.isSafeInteger((entry as Record<string, unknown>).createdAt)
    ) {
      throw new Error("Control-plane migration journal is invalid.");
    }
    return entry as ControlPlaneRecoveryMigrationEntry;
  });
}

function parseCounts(serialized: string): RecoveryObjectCounts {
  const value = parseNumberRecord(serialized);
  const names = ["teams", "users", "projects", "servers", "auditEntries", "backupRuns"] as const;
  if (names.some((name) => !Number.isSafeInteger(value[name]) || value[name] < 0)) {
    throw new Error("Control-plane object counts are invalid.");
  }
  return {
    teams: value.teams,
    users: value.users,
    projects: value.projects,
    servers: value.servers,
    auditEntries: value.auditEntries,
    backupRuns: value.backupRuns
  };
}

function parseNumberRecord(serialized: string): Record<string, number> {
  const value = JSON.parse(serialized) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Control-plane verification returned invalid data.");
  }
  const parsed: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) {
      throw new Error("Control-plane verification returned invalid data.");
    }
    parsed[key] = item;
  }
  return parsed;
}

export const controlPlaneRecoveryDatabaseQueryTestHooks = {
  migrationJournalSql: MIGRATION_JOURNAL_SQL,
  sanitizedStateSql: SANITIZED_STATE_SQL,
  parseCounts,
  parseMigrations
};
