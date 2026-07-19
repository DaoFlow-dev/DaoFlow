import { decrypt, encrypt } from "../crypto";
import type { gitInstallations } from "../schema/git-providers";

type StoredInstallationPermissions = {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenType?: string;
  expiresAt?: string;
};

export function encodeGitInstallationPermissions(input: {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
}) {
  return JSON.stringify({
    accessTokenEncrypted: encrypt(input.accessToken),
    ...(input.refreshToken ? { refreshTokenEncrypted: encrypt(input.refreshToken) } : {}),
    tokenType: input.tokenType ?? "bearer",
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {})
  } satisfies StoredInstallationPermissions);
}

export function readLegacyGitInstallationOAuthCredentials(
  installation: Pick<typeof gitInstallations.$inferSelect, "permissions">
): {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: string | null;
} | null {
  if (!installation.permissions) return null;

  try {
    const parsed = JSON.parse(installation.permissions) as StoredInstallationPermissions;
    if (typeof parsed.accessTokenEncrypted !== "string") return null;
    return {
      accessToken: decrypt(parsed.accessTokenEncrypted),
      refreshToken:
        typeof parsed.refreshTokenEncrypted === "string"
          ? decrypt(parsed.refreshTokenEncrypted)
          : null,
      tokenType: parsed.tokenType ?? "bearer",
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null
    };
  } catch {
    return null;
  }
}
