import { createCipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ControlPlaneRecoveryManifest } from "../../../db/schema/control-plane-recovery";
import {
  CONTROL_PLANE_RECOVERY_FORMAT_VERSION,
  type CreatedControlPlaneRecoveryBundle
} from "./control-plane-recovery-types";
import {
  bundleHeader,
  encryptionKey,
  signRecoverySidecar
} from "./control-plane-recovery-bundle-crypto";

export {
  extractEncryptedControlPlaneRecoveryBundle,
  verifyControlPlaneRecoverySidecar
} from "./control-plane-recovery-bundle-reader";

export async function createEncryptedControlPlaneRecoveryBundle(input: {
  workspace: string;
  dumpPath: string;
  manifest: ControlPlaneRecoveryManifest;
  keyMaterial: string;
}): Promise<CreatedControlPlaneRecoveryBundle> {
  const bundlePath = join(input.workspace, "recovery-bundle.dfr");
  const sidecarPath = join(input.workspace, "manifest.json");
  const latestSidecarPath = join(input.workspace, "latest.json");
  const manifestBuffer = Buffer.from(JSON.stringify(input.manifest), "utf8");
  const dumpSize = statSync(input.dumpPath).size;
  if (manifestBuffer.length > 1024 * 1024 || !Number.isSafeInteger(dumpSize) || dumpSize < 1) {
    throw new Error("Sanitized control-plane dump or manifest is unavailable.");
  }

  const header = bundleHeader();
  const plaintextPrefix = Buffer.concat([
    uint32(manifestBuffer.length),
    manifestBuffer,
    uint64(dumpSize)
  ]);
  const hash = createHash("sha256");
  const output = createWriteStream(bundlePath, { mode: 0o600 });
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(input.keyMaterial), header.iv);
  cipher.setAAD(header.bytes);
  hash.update(header.bytes);

  const digestAndTag = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      callback(null, chunk);
    },
    flush(callback) {
      const tag = cipher.getAuthTag();
      hash.update(tag);
      callback(null, tag);
    }
  });
  output.write(header.bytes);
  await pipeline(
    Readable.from(plaintextChunks(plaintextPrefix, input.dumpPath)),
    cipher,
    digestAndTag,
    output
  );

  const bundleSha256 = hash.digest("hex");
  const sidecarJson = `${JSON.stringify(
    signRecoverySidecar(
      {
        formatVersion: CONTROL_PLANE_RECOVERY_FORMAT_VERSION,
        bundleId: input.manifest.bundleId,
        appVersion: input.manifest.appVersion,
        schemaVersion: input.manifest.schemaVersion,
        createdAt: input.manifest.createdAt,
        bundlePath: input.manifest.objects.bundlePath,
        bundleSha256,
        keyFingerprint: input.manifest.recoveryKey.fingerprint,
        compatibility: input.manifest.compatibility,
        requiredExternalSecrets: input.manifest.requiredExternalSecrets
      },
      input.keyMaterial
    )
  )}\n`;
  writeFileSync(sidecarPath, sidecarJson, { encoding: "utf8", mode: 0o600 });
  writeFileSync(latestSidecarPath, sidecarJson, { encoding: "utf8", mode: 0o600 });

  return {
    bundlePath,
    sidecarPath,
    latestSidecarPath,
    bundleSha256,
    sizeBytes: statSync(bundlePath).size
  };
}

async function* plaintextChunks(prefix: Buffer, dumpPath: string): AsyncGenerator<Buffer> {
  yield prefix;
  for await (const chunk of createReadStream(dumpPath)) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

function uint32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}

function uint64(value: number): Buffer {
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(BigInt(value));
  return result;
}
