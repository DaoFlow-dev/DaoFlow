import { createDecipheriv } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  openSync,
  readSync,
  statSync
} from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { ControlPlaneRecoveryManifest } from "../../../db/schema/control-plane-recovery";
import type { ControlPlaneRecoveryKeySet } from "../../../db/services/control-plane-recovery-key";
import { sha256File } from "./control-plane-recovery-safety";
import {
  BUNDLE_AUTH_TAG_BYTES,
  BUNDLE_HEADER_BYTES,
  BUNDLE_MAGIC,
  encryptionKey,
  readBundleAuthTag,
  readBundleHeader,
  verifyRecoverySidecar
} from "./control-plane-recovery-bundle-crypto";

export async function extractEncryptedControlPlaneRecoveryBundle(input: {
  workspace: string;
  bundlePath: string;
  keySet: ControlPlaneRecoveryKeySet;
}): Promise<{ manifest: ControlPlaneRecoveryManifest; dumpPath: string; bundleSha256: string }> {
  mkdirSync(input.workspace, { recursive: true, mode: 0o700 });
  const header = readBundleHeader(input.bundlePath);
  const payloadPath = join(input.workspace, "recovery-payload.bin");
  const candidates = [input.keySet.currentKeyMaterial, input.keySet.previousKeyMaterial].filter(
    (value): value is string => Boolean(value)
  );
  for (const candidate of candidates) {
    try {
      await decryptBundlePayload(input.bundlePath, payloadPath, header, candidate);
      return {
        ...(await extractPayload(payloadPath, input.workspace)),
        bundleSha256: await sha256File(input.bundlePath)
      };
    } catch {
      // Old bundles remain verifiable only during the explicit rotation window.
    }
  }
  throw new Error("Recovery bundle could not be authenticated with the configured recovery keys.");
}

export const verifyControlPlaneRecoverySidecar = verifyRecoverySidecar;

async function decryptBundlePayload(
  bundlePath: string,
  payloadPath: string,
  header: Buffer,
  keyMaterial: string
): Promise<void> {
  const size = statSync(bundlePath).size;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyMaterial),
    header.subarray(BUNDLE_MAGIC.length + 1)
  );
  decipher.setAAD(header);
  decipher.setAuthTag(readBundleAuthTag(bundlePath));
  await pipeline(
    createReadStream(bundlePath, {
      start: BUNDLE_HEADER_BYTES,
      end: size - BUNDLE_AUTH_TAG_BYTES - 1
    }),
    decipher,
    createWriteStream(payloadPath, { mode: 0o600 })
  );
}

async function extractPayload(
  payloadPath: string,
  workspace: string
): Promise<{ manifest: ControlPlaneRecoveryManifest; dumpPath: string }> {
  const size = statSync(payloadPath).size;
  const fd = openSync(payloadPath, "r");
  try {
    const manifestLengthBuffer = Buffer.alloc(4);
    readExact(fd, manifestLengthBuffer, 0);
    const manifestLength = manifestLengthBuffer.readUInt32BE(0);
    if (manifestLength < 2 || manifestLength > 1024 * 1024) {
      throw new Error("Recovery bundle inner manifest is invalid.");
    }
    const manifestBuffer = Buffer.alloc(manifestLength);
    readExact(fd, manifestBuffer, 4);
    const dumpLengthBuffer = Buffer.alloc(8);
    readExact(fd, dumpLengthBuffer, 4 + manifestLength);
    const dumpLength = Number(dumpLengthBuffer.readBigUInt64BE(0));
    const dumpOffset = 4 + manifestLength + 8;
    if (!Number.isSafeInteger(dumpLength) || dumpLength < 1 || dumpOffset + dumpLength !== size) {
      throw new Error("Recovery bundle payload length is invalid.");
    }
    const manifest = JSON.parse(manifestBuffer.toString("utf8")) as ControlPlaneRecoveryManifest;
    if (manifest.formatVersion !== 1)
      throw new Error("Recovery bundle inner manifest version is unsupported.");
    const dumpPath = join(workspace, "downloaded-sanitized.dump");
    await pipeline(
      createReadStream(payloadPath, { start: dumpOffset }),
      createWriteStream(dumpPath, { mode: 0o600 })
    );
    return { manifest, dumpPath };
  } finally {
    closeSync(fd);
  }
}

function readExact(fd: number, output: Buffer, position: number): void {
  if (readSync(fd, output, 0, output.length, position) !== output.length) {
    throw new Error("Recovery bundle payload is truncated.");
  }
}
