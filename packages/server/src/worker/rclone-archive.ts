import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { processRunner } from "./process-runner";

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

  try {
    if (mode === "archive-7z") {
      processRunner.execFileSync(
        "7z",
        ["a", "-t7z", `-p${password}`, "-mhe=on", "-mx=5", archivePath, sourcePath],
        { timeout: 300_000, stdio: ["pipe", "pipe", "pipe"] }
      );
    } else {
      processRunner.execFileSync(
        "7z",
        ["a", "-tzip", `-p${password}`, "-mem=AES256", "-mx=5", archivePath, sourcePath],
        { timeout: 300_000, stdio: ["pipe", "pipe", "pipe"] }
      );
    }
    return { archivePath, originalPath: sourcePath, success: true };
  } catch (err) {
    return {
      archivePath,
      originalPath: sourcePath,
      success: false,
      error: err instanceof Error ? err.message : String(err)
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
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
