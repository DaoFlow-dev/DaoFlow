import { createHash } from "node:crypto";
import { existsSync, createReadStream, unlinkSync } from "node:fs";

export function computeChecksumStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function computeFileChecksum(filePath: string): Promise<string> {
  return computeChecksumStream(filePath);
}

export function cleanupDumpFile(dumpPath: string): Promise<void> {
  try {
    if (existsSync(dumpPath)) unlinkSync(dumpPath);
  } catch {
    /* ignore cleanup errors */
  }
  return Promise.resolve();
}
