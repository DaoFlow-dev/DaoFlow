import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SAFE_ENV_VALUE = /^[A-Za-z0-9_./:@+-]*$/;
const DATABASE_URL_PATTERN = /\b(?:postgres|postgresql):\/\/[^\s"'`\\]+/giu;
const SESSION_COOKIE_PATTERN = /((?:__Secure-)?better-auth\.session_token=)[^;\s,]+/giu;
const SESSION_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /((?:__Secure-)?better-auth\.session_token|(?:[A-Za-z0-9_-]*?(?:secret|password|token|key))|(?:database_url|postgres_password|session(?:[_-]?token)?))\s*([=:])\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;)\]}\r\n]+)/giu;

export type RecoveryRestoreRedactionInput = {
  secrets?: Readonly<Record<string, string>>;
  databasePasswords?: readonly string[];
};

function serializeEnvValue(value: string): string {
  if (SAFE_ENV_VALUE.test(value)) return value;
  if (!value.includes("'") && !value.includes("\n") && !value.includes("\r")) {
    return `'${value}'`;
  }
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "$$$$")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function updateEnvValue(contents: string, name: string, value: string): string {
  const line = `${name}=${serializeEnvValue(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(contents) ? contents.replace(pattern, line) : `${line}\n${contents}`;
}

export function buildRecoveryEnvironment(input: {
  originalContents: string;
  targetDatabase: string;
  requiredExternalSecrets: readonly string[];
  externalSecrets: Readonly<Record<string, string>>;
}): string {
  let contents = updateEnvValue(
    input.originalContents,
    "DAOFLOW_DATABASE_NAME",
    input.targetDatabase
  );
  for (const name of [...input.requiredExternalSecrets].sort()) {
    const value = input.externalSecrets[name];
    if (!value) throw new Error(`Required external secret ${name} is unavailable.`);
    contents = updateEnvValue(contents, name, value);
  }

  // A recovered database already owns its user records. Do not let clean-install
  // bootstrap credentials create or alter an account after switchover.
  contents = updateEnvValue(contents, "DAOFLOW_INITIAL_ADMIN_EMAIL", "");
  contents = updateEnvValue(contents, "DAOFLOW_INITIAL_ADMIN_PASSWORD", "");
  return contents;
}

export function writeRecoveryEnvironmentAtomically(envPath: string, contents: string): void {
  const temporaryPath = join(
    dirname(envPath),
    `.env.recovery-next-${process.pid}-${Date.now().toString(36)}`
  );
  try {
    writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, envPath);
    chmodSync(envPath, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

export function writeRecoveryConfigSnapshot(input: {
  installDir: string;
  originalContents: string;
  timestamp: Date;
}): string {
  const suffix = input.timestamp.toISOString().replace(/[:.]/g, "-");
  const path = join(input.installDir, `.env.pre-recovery-${suffix}`);
  writeFileSync(path, input.originalContents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return path;
}

/**
 * Checks the active file rather than trusting a completed-write flag. Atomic rename can succeed
 * before a later filesystem operation reports an error, so callers need the observed state.
 */
export function isRecoveryEnvironmentCurrent(envPath: string, expectedContents: string): boolean {
  try {
    return readFileSync(envPath, "utf8") === expectedContents;
  } catch {
    return false;
  }
}

/** Keep every restore error path safe for JSON and human output. */
export function redactRecoveryRestoreError(
  error: unknown,
  input: RecoveryRestoreRedactionInput = {}
): string {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Control-plane recovery restore failed.";

  message = message.replace(DATABASE_URL_PATTERN, "[redacted database URL]");
  for (const value of recoveryRedactionValues(input)) {
    message = message.split(value).join("[redacted]");
  }
  return message
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1$2[redacted]")
    .replace(SESSION_COOKIE_PATTERN, "$1[redacted]")
    .replace(SESSION_BEARER_PATTERN, "Bearer [redacted]");
}

function recoveryRedactionValues(input: RecoveryRestoreRedactionInput): string[] {
  const values = [
    ...Object.values(input.secrets ?? {}),
    ...(input.databasePasswords ?? [])
  ].flatMap((value) => (value ? [value, encodeURIComponent(value)] : []));
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

export const recoveryRestoreConfigTestHooks = { serializeEnvValue, updateEnvValue };
