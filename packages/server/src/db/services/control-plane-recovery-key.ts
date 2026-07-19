import { createHash } from "node:crypto";
import { validateEncryptionKeyMaterial } from "../crypto";

export interface ControlPlaneRecoveryKeyMetadata {
  fingerprint: string;
  rotatedAt: string | null;
}

export interface ControlPlaneRecoveryKeySet extends ControlPlaneRecoveryKeyMetadata {
  currentKeyMaterial: string;
  previousKeyMaterial: string | null;
}

/**
 * Resolves only metadata that is safe to persist or send through Temporal.
 * The key is intentionally never read from ENCRYPTION_KEY and is not returned
 * from this function.
 */
export function resolveControlPlaneRecoveryKeyMetadata(
  env: NodeJS.ProcessEnv = process.env
): ControlPlaneRecoveryKeyMetadata {
  const currentKeyMaterial = readRequiredRecoveryKey(env);
  return {
    fingerprint: fingerprint(currentKeyMaterial),
    rotatedAt: parseRotationTimestamp(env.DAOFLOW_RECOVERY_KEY_ROTATED_AT)
  };
}

/**
 * Activity-local key access for bundle encryption and verification. Callers
 * must not return this object from an activity or persist it anywhere.
 */
export function resolveControlPlaneRecoveryKeySet(
  env: NodeJS.ProcessEnv = process.env
): ControlPlaneRecoveryKeySet {
  const currentKeyMaterial = readRequiredRecoveryKey(env);
  const previousKey = env.DAOFLOW_PREVIOUS_RECOVERY_ENCRYPTION_KEY?.trim();
  const previousKeyMaterial = previousKey ? validateEncryptionKeyMaterial(previousKey, env) : null;

  return {
    currentKeyMaterial,
    previousKeyMaterial,
    fingerprint: fingerprint(currentKeyMaterial),
    rotatedAt: parseRotationTimestamp(env.DAOFLOW_RECOVERY_KEY_ROTATED_AT)
  };
}

function readRequiredRecoveryKey(env: NodeJS.ProcessEnv): string {
  const configured = env.DAOFLOW_RECOVERY_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error(
      "DAOFLOW_RECOVERY_ENCRYPTION_KEY must be configured for control-plane recovery."
    );
  }

  return validateEncryptionKeyMaterial(configured, env);
}

function parseRotationTimestamp(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("DAOFLOW_RECOVERY_KEY_ROTATED_AT must be a valid ISO-8601 timestamp.");
  }

  return parsed.toISOString();
}

function fingerprint(keyMaterial: string): string {
  return createHash("sha256").update(keyMaterial).digest("hex");
}
