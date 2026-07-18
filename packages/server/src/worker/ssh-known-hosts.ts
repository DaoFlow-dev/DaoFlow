import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { isSupportedSshHostKeyAlgorithm, sshHostKeyFingerprint } from "./ssh-host-key-scan";

export interface ManagedSshHostIdentity {
  teamId: string;
  serverId: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
}

export class SshHostIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshHostIdentityError";
  }
}

function getKnownHostsDir(): string {
  return process.env.SSH_KNOWN_HOSTS_DIR ?? "/var/lib/daoflow/ssh-known-hosts";
}

function getCurrentUserId(): number {
  const userId = process.getuid?.();
  if (typeof userId !== "number") {
    throw new SshHostIdentityError("Managed SSH trust storage requires a POSIX runtime user.");
  }
  return userId;
}

function assertOwnedPrivatePath(stats: Stats, expectedMode: number, label: string): void {
  if (stats.uid !== getCurrentUserId()) {
    throw new SshHostIdentityError(`${label} must be owned by the DaoFlow runtime user.`);
  }
  if ((stats.mode & 0o777) !== expectedMode) {
    throw new SshHostIdentityError(`${label} must have permissions ${expectedMode.toString(8)}.`);
  }
}

function ensureSecureDirectory(directory: string, label: string): void {
  if (!isAbsolute(directory)) {
    throw new SshHostIdentityError(`${label} must be an absolute path.`);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new SshHostIdentityError(`${label} must be a real directory, not a symbolic link.`);
  }
  assertOwnedPrivatePath(stats, 0o700, label);
}

function assertManagedFile(path: string): void {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new SshHostIdentityError(
        "Managed SSH known_hosts file must be a single regular file, not a link."
      );
    }
    assertOwnedPrivatePath(stats, 0o600, "Managed SSH known_hosts file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function writeManagedFileAtomically(path: string, contents: string): void {
  assertManagedFile(path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;

  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    writeSync(descriptor, contents, null, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    assertManagedFile(temporaryPath);
    renameSync(temporaryPath, path);
    assertManagedFile(path);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The directory is private; a failed cleanup cannot affect the trust decision.
    }
    throw error;
  }
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(value)) {
    throw new SshHostIdentityError(`${label} is invalid for the managed SSH trust store.`);
  }
}

function assertHostIdentity(identity: ManagedSshHostIdentity): void {
  assertSafeIdentifier(identity.teamId, "Team ID");
  assertSafeIdentifier(identity.serverId, "Server ID");
  if (!isSupportedSshHostKeyAlgorithm(identity.algorithm)) {
    throw new SshHostIdentityError("SSH host key algorithm is not supported.");
  }
  if (sshHostKeyFingerprint(identity.publicKey) !== identity.fingerprint) {
    throw new SshHostIdentityError(
      "Approved SSH host key fingerprint does not match its public key."
    );
  }
}

export function materializeManagedKnownHosts(input: {
  host: string;
  port: number;
  identity?: ManagedSshHostIdentity;
}): { path: string; controlPathToken: string } {
  const identity = input.identity;
  if (!identity) {
    throw new SshHostIdentityError(
      "SSH host identity is not approved. DaoFlow will not send credentials or commands."
    );
  }
  if (!input.host || /\s/.test(input.host) || input.host.includes(String.fromCharCode(0))) {
    throw new SshHostIdentityError("SSH host is invalid for the managed trust store.");
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new SshHostIdentityError("SSH port is invalid for the managed trust store.");
  }
  assertHostIdentity(identity);

  const baseDir = getKnownHostsDir();
  ensureSecureDirectory(baseDir, "Managed SSH trust-store directory");
  const dir = join(baseDir, identity.teamId);
  ensureSecureDirectory(dir, "Managed SSH team trust-store directory");

  const path = join(dir, `${identity.serverId}.known_hosts`);
  const host = input.port === 22 ? input.host : `[${input.host}]:${input.port}`;
  writeManagedFileAtomically(path, `${host} ${identity.algorithm} ${identity.publicKey}\n`);

  return {
    path,
    controlPathToken: createHash("sha256")
      .update(`${identity.teamId}:${identity.serverId}:${identity.fingerprint}`)
      .digest("hex")
      .slice(0, 16)
  };
}
