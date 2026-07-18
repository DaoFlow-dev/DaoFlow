import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSshGitRepositoryUrl,
  requireManagedSshGitCredential,
  strictGitSshCommand
} from "./git-ssh-trust";

const originalKnownHostsPath = process.env.DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE;
const temporaryDirs: string[] = [];

afterEach(() => {
  if (originalKnownHostsPath === undefined) {
    delete process.env.DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE;
  } else {
    process.env.DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE = originalKnownHostsPath;
  }
  for (const directory of temporaryDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "daoflow-git-ssh-trust-"));
  temporaryDirs.push(directory);
  return directory;
}

describe("strictGitSshCommand", () => {
  it("identifies SSH repository URLs and rejects ambient credential fallback", () => {
    expect(isSshGitRepositoryUrl("git@example.com:org/repo.git")).toBe(true);
    expect(isSshGitRepositoryUrl("ssh://git@example.com/org/repo.git")).toBe(true);
    expect(isSshGitRepositoryUrl("https://example.com/org/repo.git")).toBe(false);
    expect(() => requireManagedSshGitCredential("git@example.com:org/repo.git", undefined)).toThrow(
      "explicitly managed SSH key"
    );
    expect(() =>
      requireManagedSshGitCredential("git@example.com:org/repo.git", "managed-private-key")
    ).not.toThrow();
  });

  it("uses only an explicitly provisioned managed repository trust file", () => {
    const directory = temporaryDirectory();
    const knownHostsPath = join(directory, "known_hosts");
    writeFileSync(knownHostsPath, "git.example ssh-ed25519 AQIDBA==\n", { mode: 0o600 });
    process.env.DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE = knownHostsPath;

    const command = strictGitSshCommand("/tmp/deploy-key");
    expect(command).toContain("StrictHostKeyChecking=yes");
    expect(command).toContain(`UserKnownHostsFile='${knownHostsPath}'`);
    expect(command).toContain(`GlobalKnownHostsFile='${knownHostsPath}'`);
    expect(command).toContain("UpdateHostKeys=no");
    expect(command).not.toContain("accept-new");
  });

  it("rejects missing, empty, and symlinked repository trust files", () => {
    delete process.env.DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE;
    expect(() => strictGitSshCommand("/tmp/deploy-key")).toThrow(
      "DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE"
    );

    const directory = temporaryDirectory();
    const emptyPath = join(directory, "empty_known_hosts");
    writeFileSync(emptyPath, "", { mode: 0o600 });
    process.env.DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE = emptyPath;
    expect(() => strictGitSshCommand("/tmp/deploy-key")).toThrow("non-empty");

    const targetPath = join(directory, "target_known_hosts");
    const linkPath = join(directory, "linked_known_hosts");
    writeFileSync(targetPath, "git.example ssh-ed25519 AQIDBA==\n", { mode: 0o600 });
    symlinkSync(targetPath, linkPath);
    process.env.DAOFLOW_REPOSITORY_KNOWN_HOSTS_FILE = linkPath;
    expect(() => strictGitSshCommand("/tmp/deploy-key")).toThrow("regular");
  });
});
