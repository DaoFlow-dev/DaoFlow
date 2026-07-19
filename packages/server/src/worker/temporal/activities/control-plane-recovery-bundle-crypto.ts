import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";

import type { ControlPlaneRecoveryKeySet } from "../../../db/services/control-plane-recovery-key";
import {
  CONTROL_PLANE_RECOVERY_FORMAT_VERSION,
  type ControlPlaneRecoverySidecarManifest
} from "./control-plane-recovery-types";

export const BUNDLE_MAGIC = Buffer.from("DFCPR");
export const BUNDLE_IV_BYTES = 12;
export const BUNDLE_AUTH_TAG_BYTES = 16;
export const BUNDLE_HEADER_BYTES = BUNDLE_MAGIC.length + 1 + BUNDLE_IV_BYTES;

export function bundleHeader(): { bytes: Buffer; iv: Buffer } {
  const iv = randomBytes(BUNDLE_IV_BYTES);
  return {
    iv,
    bytes: Buffer.concat([BUNDLE_MAGIC, Buffer.from([CONTROL_PLANE_RECOVERY_FORMAT_VERSION]), iv])
  };
}

export function readBundleHeader(bundlePath: string): Buffer {
  const size = statSync(bundlePath).size;
  if (size <= BUNDLE_HEADER_BYTES + BUNDLE_AUTH_TAG_BYTES) {
    throw new Error("Recovery bundle is incomplete.");
  }
  const fd = openSync(bundlePath, "r");
  try {
    const header = Buffer.alloc(BUNDLE_HEADER_BYTES);
    if (readSync(fd, header, 0, header.length, 0) !== header.length) {
      throw new Error("Recovery bundle header is incomplete.");
    }
    if (!header.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)) {
      throw new Error("Recovery bundle format is not recognized.");
    }
    if (header[BUNDLE_MAGIC.length] !== CONTROL_PLANE_RECOVERY_FORMAT_VERSION) {
      throw new Error("Recovery bundle format version is unsupported.");
    }
    return header;
  } finally {
    closeSync(fd);
  }
}

export function readBundleAuthTag(bundlePath: string): Buffer {
  const size = statSync(bundlePath).size;
  const fd = openSync(bundlePath, "r");
  try {
    const tag = Buffer.alloc(BUNDLE_AUTH_TAG_BYTES);
    if (readSync(fd, tag, 0, tag.length, size - BUNDLE_AUTH_TAG_BYTES) !== tag.length) {
      throw new Error("Recovery bundle authentication tag is incomplete.");
    }
    return tag;
  } finally {
    closeSync(fd);
  }
}

export function encryptionKey(keyMaterial: string): Buffer {
  return createHash("sha256").update(keyMaterial).digest();
}

export function signRecoverySidecar(
  unsigned: Omit<ControlPlaneRecoverySidecarManifest, "hmac">,
  keyMaterial: string
): ControlPlaneRecoverySidecarManifest {
  return { ...unsigned, hmac: sign(unsigned, keyMaterial) };
}

export function verifyRecoverySidecar(
  serialized: string,
  keySet: ControlPlaneRecoveryKeySet
): Omit<ControlPlaneRecoverySidecarManifest, "hmac"> {
  const parsed = JSON.parse(serialized) as ControlPlaneRecoverySidecarManifest;
  if (!validSidecar(parsed)) throw new Error("Recovery sidecar manifest is invalid.");
  const unsigned = withoutHmac(parsed);
  const candidates = [keySet.currentKeyMaterial, keySet.previousKeyMaterial].filter(
    (value): value is string => Boolean(value)
  );
  const matchingKey = candidates.find((candidate) =>
    secureEqual(sign(unsigned, candidate), parsed.hmac)
  );
  if (!matchingKey || fingerprint(matchingKey) !== parsed.keyFingerprint) {
    throw new Error("Recovery sidecar manifest authentication failed.");
  }
  return unsigned;
}

function sign(
  unsigned: Omit<ControlPlaneRecoverySidecarManifest, "hmac">,
  keyMaterial: string
): string {
  return createHmac("sha256", encryptionKey(keyMaterial))
    .update(JSON.stringify(unsigned))
    .digest("hex");
}

function withoutHmac(
  sidecar: ControlPlaneRecoverySidecarManifest
): Omit<ControlPlaneRecoverySidecarManifest, "hmac"> {
  const { hmac: _hmac, ...unsigned } = sidecar;
  return unsigned;
}

function validSidecar(value: ControlPlaneRecoverySidecarManifest): boolean {
  return Boolean(
    value &&
    value.formatVersion === CONTROL_PLANE_RECOVERY_FORMAT_VERSION &&
    /^[A-Za-z0-9_-]{1,32}$/.test(value.bundleId) &&
    /^[a-f0-9]{64}$/i.test(value.bundleSha256) &&
    /^[a-f0-9]{64}$/i.test(value.keyFingerprint) &&
    /^[a-f0-9]{64}$/i.test(value.hmac) &&
    typeof value.appVersion === "string" &&
    value.appVersion.length > 0 &&
    typeof value.schemaVersion === "string" &&
    value.schemaVersion.length > 0 &&
    typeof value.bundlePath === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.compatibility?.minimumAppVersion === "string" &&
    typeof value.compatibility?.maximumAppVersionExclusive === "string" &&
    Array.isArray(value.requiredExternalSecrets) &&
    value.requiredExternalSecrets.every(
      (name) => typeof name === "string" && /^[A-Z][A-Z0-9_]*$/.test(name)
    )
  );
}

function fingerprint(keyMaterial: string): string {
  return createHash("sha256").update(keyMaterial).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
