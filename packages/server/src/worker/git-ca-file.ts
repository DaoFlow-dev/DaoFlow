import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const GIT_CA_DIRECTORY_PREFIX = path.join(tmpdir(), "daoflow-git-ca-");
const GIT_CA_FILE_NAME = "provider-ca.pem";

type GitConfigEntry = { key: string; value: string };

export function validateGitProviderCaRepositoryUrl(
  repoUrl: string,
  caCertificatePem: string | undefined
): void {
  if (caCertificatePem === undefined) {
    return;
  }

  if (!caCertificatePem.trim()) {
    throw new Error("The selected Git provider CA certificate is empty.");
  }

  try {
    if (new URL(repoUrl).protocol === "https:") {
      return;
    }
  } catch {
    // Fall through to the safe, user-facing failure below.
  }

  throw new Error(
    "A custom Git provider CA certificate can only be used with an HTTPS repository URL."
  );
}

export function appendGitProviderCaConfig(
  gitConfig: GitConfigEntry[],
  caFilePath: string | undefined
): GitConfigEntry[] {
  return caFilePath ? [...gitConfig, { key: "http.sslCAInfo", value: caFilePath }] : gitConfig;
}

/**
 * Makes a custom CA available only to the callback's Git child processes.
 * The PEM is never written outside the unique owner-only directory.
 */
export async function withGitProviderCaFile<T>(
  repoUrl: string,
  caCertificatePem: string | undefined,
  operation: (caFilePath: string | undefined) => Promise<T>
): Promise<T> {
  if (caCertificatePem === undefined) {
    return operation(undefined);
  }

  const pem = caCertificatePem.trim();
  validateGitProviderCaRepositoryUrl(repoUrl, caCertificatePem);

  const directory = await mkdtemp(GIT_CA_DIRECTORY_PREFIX);
  const caFilePath = path.join(directory, GIT_CA_FILE_NAME);

  try {
    await chmod(directory, 0o700);
    const file = await open(caFilePath, "wx", 0o600);
    try {
      await file.writeFile(`${pem}\n`);
    } finally {
      await file.close();
    }
    await chmod(caFilePath, 0o600);

    return await operation(caFilePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
