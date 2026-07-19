import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import {
  CONTROL_PLANE_RECOVERY_FORMAT_VERSION,
  RECOVERY_SHA256,
  assertControlPlaneRecoveryManifest,
  assertControlPlaneRecoverySidecar,
  type ControlPlaneRecoveryManifest,
  type ControlPlaneRecoverySidecar,
  type RecoveryBundleInspection,
  isRecoveryRecord
} from "./control-plane-recovery-restore-types";

const MAGIC = Buffer.from("DFCPR");
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface InspectControlPlaneRecoveryBundleInput {
  bundlePath: string;
  sidecarPath: string;
  recoveryKey: string;
  workspaceRoot?: string;
}

/**
 * Authenticates, decrypts, and extracts a recovery dump without invoking Docker.
 * The caller owns the returned workspace until it calls cleanup().
 */
export async function inspectControlPlaneRecoveryRestoreBundle(
  input: InspectControlPlaneRecoveryBundleInput
): Promise<RecoveryBundleInspection> {
  const sidecar = readAndVerifySidecar(input.sidecarPath, input.recoveryKey);
  const bundleSha256 = await sha256File(input.bundlePath);
  if (!safeEqual(bundleSha256, sidecar.bundleSha256)) {
    throw new Error("Recovery bundle SHA-256 does not match the signed sidecar.");
  }

  const workspace = createWorkspace(input.workspaceRoot);
  try {
    const header = readHeader(input.bundlePath);
    const payloadPath = join(workspace, "recovery-payload.bin");
    await decryptPayload(input.bundlePath, payloadPath, header, input.recoveryKey);
    const extracted = await extractPayload(payloadPath, workspace);
    verifyManifestIdentity(sidecar, extracted.manifest);
    if (!safeEqual(extracted.dumpSha256, extracted.manifest.database.sha256)) {
      throw new Error("Recovery bundle database checksum is invalid.");
    }

    let cleaned = false;
    return {
      bundle: {
        path: input.bundlePath,
        sidecarPath: input.sidecarPath,
        sha256: bundleSha256,
        keyFingerprint: sidecar.keyFingerprint,
        formatVersion: CONTROL_PLANE_RECOVERY_FORMAT_VERSION
      },
      manifest: extracted.manifest,
      sidecar,
      workspace,
      dumpPath: extracted.dumpPath,
      cleanup: async () => {
        if (!cleaned) {
          cleaned = true;
          rmSync(workspace, { recursive: true, force: true });
        }
      }
    };
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

export const inspectControlPlaneRecoveryBundle = inspectControlPlaneRecoveryRestoreBundle;

function readAndVerifySidecar(path: string, recoveryKey: string): ControlPlaneRecoverySidecar {
  if (!recoveryKey) throw new Error("DAOFLOW_RECOVERY_ENCRYPTION_KEY is required.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error("Recovery sidecar manifest is invalid.");
  }
  if (
    !isRecoveryRecord(parsed) ||
    typeof parsed.hmac !== "string" ||
    !RECOVERY_SHA256.test(parsed.hmac)
  ) {
    throw new Error("Recovery sidecar manifest is invalid.");
  }
  const { hmac, ...unsigned } = parsed;
  const sidecar = assertControlPlaneRecoverySidecar(unsigned);
  const expected = createHmac("sha256", encryptionKey(recoveryKey))
    .update(JSON.stringify(unsigned))
    .digest("hex");
  if (!safeEqual(expected, hmac) || !safeEqual(sha256(recoveryKey), sidecar.keyFingerprint)) {
    throw new Error("Recovery sidecar manifest authentication failed.");
  }
  return sidecar;
}

function createWorkspace(root = tmpdir()): string {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(root, "daoflow-recovery-restore-"), { encoding: "utf8" });
}

function readHeader(bundlePath: string): Buffer {
  const size = statSync(bundlePath).size;
  if (size <= HEADER_BYTES + AUTH_TAG_BYTES) throw new Error("Recovery bundle is incomplete.");
  const fd = openSync(bundlePath, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    readExact(fd, header, 0, "Recovery bundle header is incomplete.");
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Recovery bundle format is not recognized.");
    }
    if (header[MAGIC.length] !== CONTROL_PLANE_RECOVERY_FORMAT_VERSION) {
      throw new Error("Recovery bundle format version is unsupported.");
    }
    return header;
  } finally {
    closeSync(fd);
  }
}

async function decryptPayload(
  bundlePath: string,
  payloadPath: string,
  header: Buffer,
  recoveryKey: string
): Promise<void> {
  const size = statSync(bundlePath).size;
  const fd = openSync(bundlePath, "r");
  const authTag = Buffer.alloc(AUTH_TAG_BYTES);
  try {
    readExact(
      fd,
      authTag,
      size - AUTH_TAG_BYTES,
      "Recovery bundle authentication tag is incomplete."
    );
  } finally {
    closeSync(fd);
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(recoveryKey),
      header.subarray(6)
    );
    decipher.setAAD(header);
    decipher.setAuthTag(authTag);
    await pipeline(
      createReadStream(bundlePath, { start: HEADER_BYTES, end: size - AUTH_TAG_BYTES - 1 }),
      decipher,
      createWriteStream(payloadPath, { mode: 0o600 })
    );
  } catch {
    throw new Error("Recovery bundle encryption authentication failed.");
  }
}

async function extractPayload(
  payloadPath: string,
  workspace: string
): Promise<{ manifest: ControlPlaneRecoveryManifest; dumpPath: string; dumpSha256: string }> {
  const size = statSync(payloadPath).size;
  const fd = openSync(payloadPath, "r");
  let manifest: ControlPlaneRecoveryManifest;
  let dumpOffset: number;
  try {
    const lengthBuffer = Buffer.alloc(4);
    readExact(fd, lengthBuffer, 0, "Recovery bundle payload is truncated.");
    const manifestLength = lengthBuffer.readUInt32BE(0);
    if (manifestLength < 2 || manifestLength > MAX_MANIFEST_BYTES) {
      throw new Error("Recovery bundle inner manifest is invalid.");
    }
    const manifestBuffer = Buffer.alloc(manifestLength);
    readExact(fd, manifestBuffer, 4, "Recovery bundle payload is truncated.");
    try {
      manifest = assertControlPlaneRecoveryManifest(
        JSON.parse(manifestBuffer.toString("utf8")) as unknown
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Recovery bundle")) throw error;
      throw new Error("Recovery bundle inner manifest is invalid.");
    }
    const dumpLengthBuffer = Buffer.alloc(8);
    readExact(fd, dumpLengthBuffer, 4 + manifestLength, "Recovery bundle payload is truncated.");
    const dumpLength = Number(dumpLengthBuffer.readBigUInt64BE(0));
    dumpOffset = 4 + manifestLength + 8;
    if (!Number.isSafeInteger(dumpLength) || dumpLength < 1 || dumpOffset + dumpLength !== size) {
      throw new Error("Recovery bundle payload length is invalid.");
    }
  } finally {
    closeSync(fd);
  }
  const dumpPath = join(workspace, "recovery.dump");
  await pipeline(
    createReadStream(payloadPath, { start: dumpOffset }),
    createWriteStream(dumpPath, { mode: 0o600 })
  );
  return { manifest, dumpPath, dumpSha256: await sha256File(dumpPath) };
}

function verifyManifestIdentity(
  sidecar: ControlPlaneRecoverySidecar,
  manifest: ControlPlaneRecoveryManifest
): void {
  if (
    sidecar.formatVersion !== manifest.formatVersion ||
    sidecar.bundleId !== manifest.bundleId ||
    sidecar.appVersion !== manifest.appVersion ||
    sidecar.schemaVersion !== manifest.schemaVersion ||
    sidecar.createdAt !== manifest.createdAt ||
    sidecar.bundlePath !== manifest.objects.bundlePath ||
    sidecar.keyFingerprint !== manifest.recoveryKey.fingerprint ||
    JSON.stringify(sidecar.compatibility) !== JSON.stringify(manifest.compatibility) ||
    !sameStrings(sidecar.requiredExternalSecrets, manifest.requiredExternalSecrets)
  ) {
    throw new Error("Recovery sidecar does not match the encrypted manifest.");
  }
}

function readExact(fd: number, buffer: Buffer, position: number, message: string): void {
  if (readSync(fd, buffer, 0, buffer.length, position) !== buffer.length) throw new Error(message);
}

function encryptionKey(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
