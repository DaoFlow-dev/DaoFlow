export function hasNonOAuthGitLabInstallation(
  installations: Array<{ credentialKind?: string | null }>
) {
  return installations.some(
    (installation) =>
      installation.credentialKind !== null &&
      installation.credentialKind !== undefined &&
      installation.credentialKind !== "oauth" &&
      installation.credentialKind !== "legacy_oauth"
  );
}
