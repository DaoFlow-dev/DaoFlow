import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const MAX_DUMP_BYTES = 2 * 1024 * 1024 * 1024;

export interface ValidatedPostgresVerificationInput {
  restoreId: string;
  dumpPath: string;
  checksum: string;
  sourceVersion: string;
  verifierVersion: string;
}

export function validatePostgresVerificationInput(input: {
  restoreId: string;
  localDumpPath: string;
  expectedSha256: string;
  sourcePostgresVersion: string;
  verifierImage: string;
}): ValidatedPostgresVerificationInput {
  const approved = new Set([
    "restoreId",
    "localDumpPath",
    "expectedSha256",
    "sourcePostgresVersion",
    "verifierImage"
  ]);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Verification input must be an object.");
  }
  if (Object.keys(input).some((key) => !approved.has(key))) {
    throw new Error("Verification input contains unsupported fields.");
  }

  const restoreId = validateRestoreId(input.restoreId);
  const dumpPath = validateDumpPath(input.localDumpPath);
  if (!/^[a-fA-F0-9]{64}$/.test(input.expectedSha256)) {
    throw new Error("Expected checksum must be a SHA-256 hexadecimal value.");
  }
  const source = /^(?<major>[1-9]\d*)(?:\.\d+(?:\.\d+)?)?$/.exec(
    input.sourcePostgresVersion?.trim()
  );
  if (!source?.groups?.major) {
    throw new Error("Trusted source PostgreSQL version must be numeric.");
  }
  const image =
    /^(?:(?:docker\.io\/)?library\/)?postgres:(?<version>(?<major>[1-9]\d*)(?:\.\d+(?:\.\d+)?)?(?:-[a-z0-9][a-z0-9._-]*)?)@sha256:[a-f0-9]{64}$/i.exec(
      input.verifierImage?.trim()
    );
  if (!image?.groups?.version || image.groups.major !== source.groups.major) {
    throw new Error(
      "Verifier image must be an official PostgreSQL image pinned to the source major."
    );
  }

  return {
    restoreId,
    dumpPath,
    checksum: input.expectedSha256.toLowerCase(),
    sourceVersion: input.sourcePostgresVersion.trim(),
    verifierVersion: image.groups.version
  };
}

function validateRestoreId(restoreId: string): string {
  if (typeof restoreId !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(restoreId)) {
    throw new Error("Verification restore ID is invalid.");
  }
  return restoreId;
}

function validateDumpPath(localDumpPath: string): string {
  if (typeof localDumpPath !== "string" || !isAbsolute(localDumpPath)) {
    throw new Error("Verification requires an absolute local dump file path.");
  }
  try {
    const path = realpathSync(resolve(localDumpPath));
    if (
      ["/var/lib/postgresql", "/var/lib/docker/volumes", "/proc", "/sys", "/dev"].some(
        (root) => path === root || path.startsWith(`${root}/`)
      )
    ) {
      throw new Error("Verification dump path is not an allowed local artifact path.");
    }
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("Verification dump path must point to a regular file.");
    if (stat.size < 1 || stat.size > MAX_DUMP_BYTES) {
      throw new Error(`Verification dump size must be between 1 byte and ${MAX_DUMP_BYTES} bytes.`);
    }
    return path;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Verification")) throw error;
    throw new Error("Verification dump file is missing or unavailable.");
  }
}
