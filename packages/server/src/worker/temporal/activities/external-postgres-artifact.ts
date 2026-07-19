import { spawn } from "node:child_process";
import { dockerCommand, withCommandPath } from "../../command-env";
import {
  listPostgresCustomArchive,
  type PostgresRestoreVerifierHooks
} from "./postgres-restore-verification";

const OFFICIAL_IMAGE =
  /^(?:(?:docker\.io\/)?library\/)?postgres:(?<tag>(?<major>[1-9]\d*)(?:\.\d+(?:\.\d+)?)?(?:-[a-z0-9][a-z0-9._-]*)?)@sha256:[a-f0-9]{64}$/i;
const REPO_DIGEST = /^(?:(?:docker\.io\/)?library\/)?postgres@sha256:(?<digest>[a-f0-9]{64})$/i;
const MAX_LISTING_EVIDENCE_CHARS = 48_000;

export type ParsedExternalPostgresArchive = {
  sourcePostgresVersion: string;
  listingEvidence: string;
};

export type PostgresVerifierImageResolverOptions = {
  runDocker?: (
    args: string[],
    input: { heartbeat?: () => void; cancellationSignal?: AbortSignal }
  ) => Promise<string>;
  heartbeat?: () => void;
  cancellationSignal?: AbortSignal;
};

export async function resolveOfficialPostgresVerifierImage(
  postgresMajor: string,
  options: PostgresVerifierImageResolverOptions = {}
): Promise<string> {
  const major = normalizePostgresMajor(postgresMajor);
  const configured = process.env[`DAOFLOW_POSTGRES_VERIFIER_IMAGE_${major}`]?.trim();
  if (configured) return assertOfficialPostgresVerifierImage(configured, major);

  const mutableTag = `postgres:${major}`;
  const runDocker = options.runDocker ?? runDockerCommand;
  try {
    await runDocker(["pull", "--quiet", mutableTag], options);
    const repoDigest = await runDocker(
      ["image", "inspect", "--format", "{{index .RepoDigests 0}}", mutableTag],
      options
    );
    const match = REPO_DIGEST.exec(repoDigest.trim());
    if (!match?.groups?.digest) {
      throw new Error("missing official repository digest");
    }
    return `postgres:${major}@sha256:${match.groups.digest}`;
  } catch {
    throw new Error("An immutable official PostgreSQL verifier image could not be resolved.");
  }
}

export async function inspectExternalPostgresCustomArchive(input: {
  artifactId: string;
  dumpPath: string;
  checksum: string;
  expectedPostgresMajor: string;
  verifierImage: string;
  verifierHooks?: Partial<PostgresRestoreVerifierHooks>;
}): Promise<ParsedExternalPostgresArchive> {
  const major = normalizePostgresMajor(input.expectedPostgresMajor);
  const verifierImage = assertOfficialPostgresVerifierImage(input.verifierImage, major);
  const result = await listPostgresCustomArchive(
    {
      restoreId: input.artifactId,
      localDumpPath: input.dumpPath,
      expectedSha256: input.checksum,
      sourcePostgresVersion: major,
      verifierImage
    },
    input.verifierHooks
  );
  return parseExternalPostgresArchiveListing(result.listing, major);
}

export function parseExternalPostgresArchiveListing(
  listing: string,
  expectedPostgresMajor: string
): ParsedExternalPostgresArchive {
  const major = normalizePostgresMajor(expectedPostgresMajor);
  const sanitized = sanitizePgRestoreListing(listing);
  if (!/^;\s*Format:\s*Custom\s*$/im.test(sanitized)) {
    throw new Error("External artifact is not a PostgreSQL custom-format archive.");
  }
  const source =
    /^;\s*Dumped from database version:\s*(?<version>[1-9]\d*(?:\.\d+){0,2})(?:\s+\([^\r\n)]{1,200}\))?\s*$/im.exec(
      sanitized
    )?.groups?.version;
  const sourceMajor = source?.split(".")[0];
  if (!source || sourceMajor !== major) {
    throw new Error("External artifact PostgreSQL version does not match the requested major.");
  }

  for (const entry of extractTocEntryTypes(sanitized)) {
    if (UNSAFE_TOC_ENTRY_TYPES.has(entry)) {
      throw new Error(`External artifact contains unsupported archive entry type: ${entry}.`);
    }
    if (!SUPPORTED_TOC_ENTRY_TYPES.has(entry)) {
      throw new Error(`External artifact contains an unrecognized archive entry type: ${entry}.`);
    }
  }

  return { sourcePostgresVersion: source, listingEvidence: sanitized };
}

export function sanitizePgRestoreListing(listing: string): string {
  if (typeof listing !== "string" || listing.length === 0) {
    throw new Error("PostgreSQL archive listing is empty.");
  }
  const cleaned = stripUnsafeControlCharacters(listing)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]+)?@/gi, "$1[redacted]@")
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|credential)\s*([=:])\s*[^\s,;]+/gi,
      "$1$2[redacted]"
    )
    .split("\n")
    .map((line) => line.trimEnd().slice(0, 500))
    .filter((line) => line.length > 0)
    .join("\n");
  if (!cleaned) throw new Error("PostgreSQL archive listing is empty.");
  return cleaned.slice(0, MAX_LISTING_EVIDENCE_CHARS);
}

function stripUnsafeControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("");
}

function normalizePostgresMajor(value: string): string {
  const major = value.trim();
  if (!/^[1-9]\d*$/.test(major)) {
    throw new Error("PostgreSQL major version must be a positive integer.");
  }
  return major;
}

function assertOfficialPostgresVerifierImage(image: string, expectedMajor: string): string {
  const match = OFFICIAL_IMAGE.exec(image.trim());
  if (!match?.groups?.major || match.groups.major !== expectedMajor) {
    throw new Error(
      "Verifier image must be an immutable official PostgreSQL image for the requested major."
    );
  }
  return image.trim();
}

function runDockerCommand(
  args: string[],
  input: { heartbeat?: () => void; cancellationSignal?: AbortSignal }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerCommand, args, {
      env: withCommandPath(process.env),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeatTimer);
      removeAbortListener?.();
      callback();
    };
    const heartbeat = () => input.heartbeat?.();
    heartbeat();
    const heartbeatTimer = setInterval(heartbeat, 15_000);
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      settle(() => reject(new Error("Verifier image pull timed out.")));
    }, 300_000);
    const abort = () => {
      child.kill("SIGTERM");
      settle(() => reject(new Error("Verifier image pull was cancelled.")));
    };
    const removeAbortListener = input.cancellationSignal
      ? () => input.cancellationSignal?.removeEventListener("abort", abort)
      : undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", () => settle(() => reject(new Error("Verifier image command failed."))));
    child.on("close", (code) =>
      settle(() =>
        code === 0 ? resolve(stdout) : reject(new Error("Verifier image command failed."))
      )
    );
    if (input.cancellationSignal) {
      if (input.cancellationSignal.aborted) abort();
      else input.cancellationSignal.addEventListener("abort", abort, { once: true });
    }
  });
}

const UNSAFE_TOC_ENTRY_TYPES = new Set([
  "DATABASE",
  "TABLESPACE",
  "BLOB",
  "BLOB DATA",
  "BLOBS",
  "BLOBS DATA",
  "FOREIGN DATA WRAPPER",
  "FOREIGN SERVER",
  "USER MAPPING",
  "SUBSCRIPTION",
  "PUBLICATION",
  "EVENT TRIGGER",
  "SECURITY LABEL"
]);

const SUPPORTED_TOC_ENTRY_TYPES = new Set([
  "ACL",
  "AGGREGATE",
  "CAST",
  "CHECK CONSTRAINT",
  "COLLATION",
  "COMMENT",
  "CONSTRAINT",
  "CONVERSION",
  "DEFAULT",
  "DEFAULT ACL",
  "DOMAIN",
  "EXTENSION",
  "EXTENSION COMMENT",
  "FK CONSTRAINT",
  "FUNCTION",
  "INDEX",
  "MATERIALIZED VIEW",
  "MATERIALIZED VIEW DATA",
  "OPERATOR",
  "OPERATOR CLASS",
  "OPERATOR FAMILY",
  "POLICY",
  "PROCEDURE",
  "RULE",
  "SCHEMA",
  "SEQUENCE",
  "SEQUENCE OWNED BY",
  "SEQUENCE SET",
  "SHELL TYPE",
  "TABLE",
  "TABLE DATA",
  "TEXT SEARCH CONFIGURATION",
  "TEXT SEARCH DICTIONARY",
  "TEXT SEARCH PARSER",
  "TEXT SEARCH TEMPLATE",
  "TRIGGER",
  "TYPE",
  "VIEW"
]);

function extractTocEntryTypes(listing: string): string[] {
  const entries: string[] = [];
  for (const line of listing.split("\n")) {
    if (!/^\d+;/.test(line)) continue;
    const body = line.replace(/^\d+;\s*\d+\s+\d+\s+/, "");
    const type = [...UNSAFE_TOC_ENTRY_TYPES, ...SUPPORTED_TOC_ENTRY_TYPES]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => body === candidate || body.startsWith(`${candidate} `));
    if (!type) throw new Error("External artifact contains an unrecognized archive entry type.");
    entries.push(type);
  }
  if (entries.length === 0) {
    throw new Error("PostgreSQL archive listing did not contain any table-of-contents entries.");
  }
  return entries;
}
