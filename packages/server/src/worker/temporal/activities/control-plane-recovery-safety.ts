import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ControlPlaneRecoveryObjectPaths } from "./control-plane-recovery-types";

const BUNDLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export const RECOVERY_SANITIZED_FIELDS = [
  "accounts.access_token",
  "accounts.refresh_token",
  "accounts.id_token",
  "backup_destinations.access_key",
  "backup_destinations.secret_access_key",
  "backup_destinations.rclone_config",
  "backup_destinations.oauth_token",
  "backup_destinations.oauth_token_expiry",
  "backup_destinations.encryption_password",
  "backup_destinations.encryption_salt",
  "git_providers.webhook_secret",
  "notification_channels.webhook_url",
  "notification_logs.*",
  "push_subscriptions.*",
  "sessions.*",
  "verifications.*",
  "two_factor.*",
  "users.two_factor_enabled",
  "users.mfa_enrolled_at",
  "cli_auth_requests.*",
  "git_provider_setup_states.*"
] as const;

export function assertControlPlaneRecoveryBundleId(bundleId: string): string {
  if (typeof bundleId !== "string" || !BUNDLE_ID_PATTERN.test(bundleId)) {
    throw new Error("Control-plane recovery bundle ID is invalid.");
  }
  return bundleId;
}

export function controlPlaneRecoveryObjectPaths(bundleId: string): ControlPlaneRecoveryObjectPaths {
  const safeBundleId = assertControlPlaneRecoveryBundleId(bundleId);
  const prefix = `control-plane-recovery/v1/${safeBundleId}`;
  return {
    prefix,
    bundlePath: `${prefix}/bundle.dfr`,
    manifestPath: `${prefix}/manifest.json`,
    latestManifestPath: "control-plane-recovery/v1/latest.json"
  };
}

export function createControlPlaneRecoveryWorkspace(bundleId: string): string {
  const safeBundleId = assertControlPlaneRecoveryBundleId(bundleId);
  return mkdtempSync(join(tmpdir(), `daoflow-recovery-${safeBundleId}-`));
}

export function cleanupControlPlaneRecoveryWorkspace(workspace: string): void {
  try {
    rmSync(workspace, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    // Workspace cleanup is best effort. Container cleanup remains a separate strict gate.
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return hash.digest("hex");
}

export function safeControlPlaneRecoveryError(error: unknown): string {
  const original = error instanceof Error ? error.message : String(error);
  const redacted = original
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]+)?@/gi, "$1[redacted]@")
    .replace(
      /\b(password|passwd|secret|token|credential|database_url|(?:api|recovery|encryption|private)[_\s-]*key(?:[_\s-]*material)?|key[_\s-]*material)\s*([=:])\s*[^\s,;]+/gi,
      "$1$2[redacted]"
    );
  return redacted.length > 300 ? `${redacted.slice(0, 300)}…` : redacted;
}

export function nextMajorVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return match ? `${Number(match[1]) + 1}.0.0` : version;
}
