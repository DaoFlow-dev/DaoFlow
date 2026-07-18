import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  archiveInspectionCommand,
  beforePostgresVerificationDeadline,
  createVerificationContainerCommand,
  defaultPostgresRestoreVerifierHooks,
  makeVerificationContainer,
  POSTGRES_CLEANUP_TIMEOUT_MS,
  postgresCatalogCommand,
  postgresRestoreCommand,
  verificationCommand,
  VerificationTimeoutError,
  waitForPostgresReadiness,
  type PostgresRestoreVerifierHooks,
  type VerificationContainer
} from "./postgres-restore-verification-commands";
import { validatePostgresVerificationInput } from "./postgres-restore-verification-input";

const ERROR_LIMIT = 500;
const CHECK_NAMES = [
  "input",
  "checksum",
  "verifierImage",
  "archive",
  "container",
  "readiness",
  "restore",
  "catalog"
] as const;
export interface PostgresRestoreVerificationInput {
  restoreId: string;
  localDumpPath: string;
  expectedSha256: string;
  sourcePostgresVersion: string;
  verifierImage: string;
}

type CheckName = (typeof CHECK_NAMES)[number];
export type PostgresRestoreVerificationCheckStatus = "passed" | "failed" | "skipped";
export interface PostgresRestoreVerificationCheck {
  status: PostgresRestoreVerificationCheckStatus;
  detail: string;
}
export interface PostgresRestoreObjectCounts {
  schemas: number;
  tables: number;
  indexes: number;
  functions: number;
}
export interface PostgresRestoreVerificationResult {
  version: 1;
  success: boolean;
  checksum: string;
  sourcePostgresVersion: string;
  verifierPostgresVersion: string;
  durationMs: number;
  completedAt: string;
  checks: Record<CheckName, PostgresRestoreVerificationCheck>;
  objectCounts: PostgresRestoreObjectCounts;
  cleanup: { attempted: boolean; containerRemoved: boolean; error?: string };
  error?: string;
}
export type {
  PostgresRestoreVerificationCommand,
  PostgresRestoreVerifierHooks
} from "./postgres-restore-verification-commands";
/** Isolated dump verification. The input deliberately has no live target or credentials. */
export async function verifyPostgresRestore(
  input: PostgresRestoreVerificationInput,
  overrides: Partial<PostgresRestoreVerifierHooks> = {}
): Promise<PostgresRestoreVerificationResult> {
  return createPostgresRestoreVerifier(overrides).verify(input);
}
export function createPostgresRestoreVerifier(
  overrides: Partial<PostgresRestoreVerifierHooks> = {}
): {
  verify: (input: PostgresRestoreVerificationInput) => Promise<PostgresRestoreVerificationResult>;
} {
  const hooks = { ...defaultPostgresRestoreVerifierHooks, ...overrides };
  return { verify: (input) => verify(input, hooks) };
}
async function verify(
  input: PostgresRestoreVerificationInput,
  hooks: PostgresRestoreVerifierHooks
): Promise<PostgresRestoreVerificationResult> {
  const startedAt = hooks.now();
  const checks = createChecks();
  const objectCounts: PostgresRestoreObjectCounts = {
    schemas: 0,
    tables: 0,
    indexes: 0,
    functions: 0
  };
  const cleanup: PostgresRestoreVerificationResult["cleanup"] = {
    attempted: false,
    containerRemoved: false
  };
  let checksum = "";
  let sourcePostgresVersion = "unverified";
  let verifierPostgresVersion = "unverified";
  let container: VerificationContainer | undefined;
  let error: string | undefined;
  try {
    const valid = validatePostgresVerificationInput(input);
    checksum = valid.checksum;
    sourcePostgresVersion = valid.sourceVersion;
    verifierPostgresVersion = valid.verifierVersion;
    checks.input = passed("Local regular-file dump input is allowed.");
    let actualChecksum: string;
    try {
      actualChecksum = await checksumFile(valid.dumpPath);
    } catch {
      throw new Error("Dump checksum could not be calculated.");
    }
    if (!timingSafeEqual(Buffer.from(actualChecksum), Buffer.from(valid.checksum))) {
      throw new Error("Dump checksum does not match the expected SHA-256 value.");
    }
    checks.checksum = passed("SHA-256 checksum matches.");
    await beforePostgresVerificationDeadline(
      hooks,
      startedAt,
      verificationCommand(["image", "inspect", input.verifierImage]),
      "Verifier image inspection failed."
    );
    checks.verifierImage = passed("Pinned official PostgreSQL verifier image is available.");
    await beforePostgresVerificationDeadline(
      hooks,
      startedAt,
      archiveInspectionCommand(input.verifierImage, valid.dumpPath),
      "Custom-format archive inspection failed."
    );
    checks.archive = passed("pg_restore listed the custom-format archive without network access.");
    container = makeVerificationContainer(valid.restoreId);
    try {
      await hooks.runCommand(
        verificationCommand(["rm", "--force", container.name], POSTGRES_CLEANUP_TIMEOUT_MS)
      );
    } catch {
      // Docker reports an error when no previous attempt left a container behind.
    }
    await beforePostgresVerificationDeadline(
      hooks,
      startedAt,
      createVerificationContainerCommand(input.verifierImage, container),
      "Isolated verifier container could not be created."
    );
    cleanup.attempted = true;
    await beforePostgresVerificationDeadline(
      hooks,
      startedAt,
      verificationCommand(["start", container.name]),
      "Isolated verifier container could not be started."
    );
    checks.container = passed("Disposable container was created with isolated resource limits.");
    await waitForPostgresReadiness(hooks, startedAt, container);
    checks.readiness = passed("Isolated PostgreSQL verifier became ready.");
    await beforePostgresVerificationDeadline(
      hooks,
      startedAt,
      postgresRestoreCommand(container, valid.dumpPath),
      "pg_restore failed in the isolated verifier."
    );
    checks.restore = passed("Custom-format dump restored with fail-fast safe options.");
    const catalog = await beforePostgresVerificationDeadline(
      hooks,
      startedAt,
      postgresCatalogCommand(container),
      "Catalog verification query failed."
    );
    Object.assign(objectCounts, parseObjectCounts(catalog.stdout));
    checks.catalog = passed("Safe PostgreSQL catalog object counts were collected.");
  } catch (caught) {
    if (hooks.cancellationSignal.aborted) throw caught;
    error = redactError(caught);
    failFirstSkippedCheck(checks, error);
  } finally {
    if (container && cleanup.attempted) {
      try {
        await hooks.runCommand(
          verificationCommand(["rm", "--force", container.name], POSTGRES_CLEANUP_TIMEOUT_MS)
        );
        cleanup.containerRemoved = true;
      } catch (caught) {
        cleanup.error = redactError(caught);
        checks.container = failed(`Verifier cleanup failed: ${cleanup.error}`);
        error = error
          ? `${error} Cleanup also failed: ${cleanup.error}`
          : `Verifier cleanup failed: ${cleanup.error}`;
      }
    }
  }
  return {
    version: 1,
    success: !error && cleanup.containerRemoved,
    checksum,
    sourcePostgresVersion,
    verifierPostgresVersion,
    durationMs: Math.max(0, hooks.now() - startedAt),
    completedAt: hooks.completedAt(),
    checks,
    objectCounts,
    cleanup,
    ...(error ? { error } : {})
  };
}
async function checksumFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  const input = createReadStream(path) as AsyncIterable<Buffer>;
  for await (const chunk of input) hash.update(chunk);
  return hash.digest("hex");
}
function parseObjectCounts(stdout: string): PostgresRestoreObjectCounts {
  try {
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (
      ["schemas", "tables", "indexes", "functions"].some(
        (name) => !Number.isSafeInteger(parsed[name]) || (parsed[name] as number) < 0
      )
    ) {
      throw new Error("invalid count");
    }
    return {
      schemas: parsed.schemas as number,
      tables: parsed.tables as number,
      indexes: parsed.indexes as number,
      functions: parsed.functions as number
    };
  } catch {
    throw new Error("Verifier returned invalid catalog object counts.");
  }
}
function createChecks(): PostgresRestoreVerificationResult["checks"] {
  return Object.fromEntries(
    CHECK_NAMES.map((name) => [name, { status: "skipped", detail: "Not run." }])
  ) as PostgresRestoreVerificationResult["checks"];
}
function failFirstSkippedCheck(
  checks: PostgresRestoreVerificationResult["checks"],
  detail: string
): void {
  const target = CHECK_NAMES.find((name) => checks[name].status === "skipped") ?? "catalog";
  checks[target] = failed(detail);
}
function passed(detail: string): PostgresRestoreVerificationCheck {
  return { status: "passed", detail };
}
function failed(detail: string): PostgresRestoreVerificationCheck {
  return { status: "failed", detail: truncateAndRedact(detail) };
}
function redactError(error: unknown): string {
  return error instanceof VerificationTimeoutError
    ? error.message
    : truncateAndRedact(error instanceof Error ? error.message : String(error));
}
function truncateAndRedact(value: string): string {
  const redacted = value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]+)?@/gi, "$1[redacted]@")
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|credential)\s*([=:])\s*[^\s,;]+/gi,
      "$1$2[redacted]"
    );
  return redacted.length > ERROR_LIMIT ? `${redacted.slice(0, ERROR_LIMIT)}…` : redacted;
}
