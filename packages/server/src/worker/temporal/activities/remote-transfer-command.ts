import type { OnLog } from "../../docker-executor";
import {
  execRemote,
  MAX_REMOTE_COMMAND_TIMEOUT_MS,
  shellQuote,
  type SSHTarget
} from "../../ssh-connection";

export const REMOTE_VOLUME_TRANSFER_TIMEOUT_MS = 600_000;
export const REMOTE_VOLUME_CLEANUP_TIMEOUT_MS = 60_000;

export async function runRemoteTransferCommand(
  target: SSHTarget,
  command: string,
  preview: string,
  timeoutMs = REMOTE_VOLUME_TRANSFER_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<void> {
  const timeoutSeconds = Math.max(1, Math.floor(timeoutMs / 1_000));
  const boundedCommand = `timeout ${timeoutSeconds}s sh -ceu ${shellQuote(command)}`;
  const diagnostics: string[] = [];
  const captureDiagnostic: OnLog = (entry) => {
    if (!entry.message.startsWith("[ssh]")) {
      diagnostics.push(sanitizeDiagnostic(entry.message));
      if (diagnostics.length > 8) diagnostics.shift();
    }
  };
  const result = await execRemote(target, boundedCommand, captureDiagnostic, {
    preview,
    timeoutMs: Math.min(timeoutMs, MAX_REMOTE_COMMAND_TIMEOUT_MS),
    signal
  });
  if (result.exitCode !== 0) {
    const detail = diagnostics.at(-1);
    throw new Error(
      `${preview} failed with exit code ${result.exitCode}.${detail ? ` ${detail}` : ""}`
    );
  }
}

function sanitizeDiagnostic(message: string): string {
  return Array.from(message, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .trim()
    .slice(0, 300);
}
