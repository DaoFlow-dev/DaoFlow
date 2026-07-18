import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { isAbsolute, join } from "node:path";

function getSSHKeyDir(): string {
  return process.env.SSH_KEY_DIR ?? "/tmp/daoflow-ssh-keys";
}

function ensureSecureKeyDirectory(keyDir: string): void {
  if (!isAbsolute(keyDir)) {
    throw new Error("SSH_KEY_DIR must be an absolute path.");
  }

  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const stats = lstatSync(keyDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("SSH key directory must be a real directory, not a symbolic link.");
  }

  const userId = process.getuid?.();
  if (typeof userId !== "number" || stats.uid !== userId) {
    throw new Error("SSH key directory must be owned by the DaoFlow runtime user.");
  }
  if ((stats.mode & 0o777) !== 0o700) {
    throw new Error("SSH key directory must have permissions 700.");
  }
}

export function writeSSHKey(serverName: string, privateKey: string): string {
  const keyDir = getSSHKeyDir();
  ensureSecureKeyDirectory(keyDir);

  const keyPath = join(keyDir, `${serverName.replace(/[^a-zA-Z0-9_-]/g, "_")}-${randomUUID()}_id`);
  let descriptor: number | null = null;

  try {
    descriptor = openSync(
      keyPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    writeSync(descriptor, privateKey, null, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;

    const stats = lstatSync(keyPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new Error("SSH private key must be stored as a single regular file.");
    }
    if ((stats.mode & 0o777) !== 0o600) {
      throw new Error("SSH private key file must have permissions 600.");
    }
    return keyPath;
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    try {
      unlinkSync(keyPath);
    } catch {
      // The secure private directory prevents another process from replacing this path.
    }
    throw error;
  }
}

export function removeSSHKey(keyPath: string): void {
  try {
    unlinkSync(keyPath);
  } catch {
    // Best-effort cleanup for short-lived credential files.
  }
}
