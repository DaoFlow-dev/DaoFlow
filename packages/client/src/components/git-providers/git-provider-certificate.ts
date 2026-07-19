export interface CertificateAssetSummary {
  id: string;
  name: string;
  fingerprint: string;
  expiresAt: string | null;
  status: string;
}

export type CertificateExpiryState = "expired" | "unknown" | "soon" | "valid";

const CERTIFICATE_SOON_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export function getCertificateExpiryState(
  expiresAt: string | null,
  now = new Date()
): CertificateExpiryState {
  if (!expiresAt) return "unknown";

  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return "unknown";
  if (expiry.getTime() <= now.getTime()) return "expired";
  if (expiry.getTime() - now.getTime() <= CERTIFICATE_SOON_THRESHOLD_MS) return "soon";
  return "valid";
}

export function formatCertificateExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "unknown";

  const expiry = new Date(expiresAt);
  return Number.isNaN(expiry.getTime()) ? "unknown" : expiry.toLocaleDateString();
}

export function getCertificateExpiryMessage(expiresAt: string | null, now = new Date()): string {
  const state = getCertificateExpiryState(expiresAt, now);
  if (state === "unknown") return "Expiry unknown.";

  const date = formatCertificateExpiry(expiresAt);
  if (state === "expired") return `Expired on ${date}.`;
  if (state === "soon") return `Expires on ${date} (within 30 days).`;
  return `Expires on ${date}.`;
}

export function getCertificateAsset(
  assets: CertificateAssetSummary[],
  certificateId: string | null | undefined
): CertificateAssetSummary | null {
  if (!certificateId) return null;
  return assets.find((asset) => asset.id === certificateId) ?? null;
}

export function getGitProviderErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function getCertificateStatusClass(state: CertificateExpiryState): string {
  if (state === "expired") return "text-destructive";
  if (state === "soon" || state === "unknown") return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}
