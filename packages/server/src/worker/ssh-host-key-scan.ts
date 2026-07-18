import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const MAX_SCAN_OUTPUT_BYTES = 64 * 1024;
const supportedAlgorithm = /^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521))$/;
const base64Key = /^[A-Za-z0-9+/]+={0,2}$/;

export interface ObservedSshHostKey {
  algorithm: string;
  publicKey: string;
  fingerprint: string;
}

export type SshHostKeyScanner = (target: {
  host: string;
  port: number;
}) => Promise<ObservedSshHostKey[]>;

export function isSupportedSshHostKeyAlgorithm(algorithm: string): boolean {
  return supportedAlgorithm.test(algorithm);
}

export function sshHostKeyFingerprint(publicKey: string): string {
  const normalized = publicKey.trim();
  if (!base64Key.test(normalized)) {
    throw new Error("SSH host key must be base64-encoded public key material.");
  }

  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0) {
    throw new Error("SSH host key must not be empty.");
  }

  return `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;
}

export function parseSshHostKeyScan(output: string): ObservedSshHostKey[] {
  const discovered = new Map<string, ObservedSshHostKey>();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const [, algorithm, publicKey] = trimmed.split(/\s+/, 3);
    if (!algorithm || !publicKey || !isSupportedSshHostKeyAlgorithm(algorithm)) continue;

    try {
      const fingerprint = sshHostKeyFingerprint(publicKey);
      discovered.set(`${algorithm}:${fingerprint}`, { algorithm, publicKey, fingerprint });
    } catch {
      // A scanner response is untrusted. Ignore malformed candidate lines.
    }
  }

  return [...discovered.values()].toSorted((left, right) =>
    `${left.algorithm}:${left.fingerprint}`.localeCompare(`${right.algorithm}:${right.fingerprint}`)
  );
}

export const scanSshHostKeys: SshHostKeyScanner = async ({ host, port }) => {
  if (!host || /\s/.test(host) || host.includes(String.fromCharCode(0))) {
    throw new Error("SSH host scan requires a valid host name or address.");
  }

  return new Promise((resolve, reject) => {
    const command = process.env.SSH_KEYSCAN_COMMAND ?? "ssh-keyscan";
    const child = spawn(command, ["-T", "5", "-p", String(port), host], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      if (stdout.length < MAX_SCAN_OUTPUT_BYTES) stdout += data.toString("utf8");
    });
    child.stderr.on("data", (data: Buffer) => {
      if (stderr.length < MAX_SCAN_OUTPUT_BYTES) stderr += data.toString("utf8");
    });
    child.on("error", (error) => reject(error));
    child.on("close", () => {
      const keys = parseSshHostKeyScan(stdout);
      if (keys.length > 0) {
        resolve(keys);
        return;
      }
      reject(
        new Error(
          `No SSH host keys were discovered for ${host}:${port}.${stderr ? ` ${stderr.trim()}` : ""}`
        )
      );
    });
  });
};
