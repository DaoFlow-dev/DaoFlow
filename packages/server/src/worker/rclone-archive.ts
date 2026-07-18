import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { processRunner } from "./process-runner";

function redactPassword(value: string, password: string): string {
  return password ? value.replaceAll(password, "[redacted]") : value;
}

export interface ArchiveEncryptResult {
  archivePath: string;
  originalPath: string;
  success: boolean;
  error?: string;
}

export function archiveEncrypt(
  sourcePath: string,
  password: string,
  mode: "archive-7z" | "archive-zip" = "archive-7z"
): ArchiveEncryptResult {
  const ext = mode === "archive-7z" ? "7z" : "zip";
  const archivePath = join(tmpdir(), `daoflow-backup-${randomBytes(8).toString("hex")}.${ext}`);
  const sourceIsDirectory = existsSync(sourcePath) && statSync(sourcePath).isDirectory();
  const archiveInput = sourceIsDirectory ? "." : sourcePath;
  const commandOptions = {
    timeout: 300_000,
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
    ...(sourceIsDirectory ? { cwd: sourcePath } : {})
  };

  try {
    if (mode === "archive-7z") {
      processRunner.execFileSync(
        "7z",
        ["a", "-t7z", `-p${password}`, "-mhe=on", "-mx=5", archivePath, archiveInput],
        commandOptions
      );
    } else {
      processRunner.execFileSync(
        "7z",
        ["a", "-tzip", `-p${password}`, "-mem=AES256", "-mx=5", archivePath, archiveInput],
        commandOptions
      );
    }
    return { archivePath, originalPath: sourcePath, success: true };
  } catch (err) {
    return {
      archivePath,
      originalPath: sourcePath,
      success: false,
      error: redactPassword(err instanceof Error ? err.message : String(err), password)
    };
  }
}

export function archiveDecrypt(
  archivePath: string,
  password: string,
  outputDir: string
): ArchiveEncryptResult {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    processRunner.execFileSync("7z", ["x", `-p${password}`, `-o${outputDir}`, "-y", archivePath], {
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { archivePath, originalPath: outputDir, success: true };
  } catch (err) {
    return {
      archivePath,
      originalPath: outputDir,
      success: false,
      error: redactPassword(err instanceof Error ? err.message : String(err), password)
    };
  }
}
