import { lstatSync, type Stats } from "node:fs";
import { isAbsolute } from "node:path";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function managedRepositoryKnownHostsPath(): string {
  const knownHostsPath = process.env.DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE;
  if (!knownHostsPath) {
    throw new Error(
      "SSH Git clones require DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE to point to a provisioned managed known_hosts file."
    );
  }
  if (!isAbsolute(knownHostsPath)) {
    throw new Error("DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE must be an absolute path.");
  }

  let stats: Stats;
  try {
    stats = lstatSync(knownHostsPath);
  } catch {
    throw new Error(
      "The configured repository known_hosts file does not exist. Provision approved repository host keys before using SSH Git clones."
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0 || (stats.mode & 0o022) !== 0) {
    throw new Error(
      "The configured repository known_hosts file must be a non-empty, regular, non-group-writable managed file."
    );
  }
  return knownHostsPath;
}

export function isSshGitRepositoryUrl(repoUrl: string): boolean {
  const normalized = repoUrl.trim();
  return /^(?:ssh|git\+ssh):\/\//i.test(normalized) || /^[^/@\s]+@[^/:\s]+:.+/.test(normalized);
}

export function requireManagedSshGitCredential(
  repoUrl: string,
  privateKey: string | null | undefined
): void {
  if (isSshGitRepositoryUrl(repoUrl) && !privateKey?.trim()) {
    throw new Error(
      "SSH repository checkouts require an explicitly managed SSH key and repository host trust."
    );
  }
}

export function strictGitSshCommand(keyPath: string): string {
  const knownHostsPath = managedRepositoryKnownHostsPath();
  return [
    "ssh",
    "-i",
    shellQuote(keyPath),
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${shellQuote(knownHostsPath)}`,
    "-o",
    `GlobalKnownHostsFile=${shellQuote(knownHostsPath)}`,
    "-o",
    "UpdateHostKeys=no"
  ].join(" ");
}
