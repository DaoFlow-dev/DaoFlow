/**
 * stream-to-file.ts — Shared helper for streaming request bodies to disk.
 *
 * Used by images.ts and deploy-context.ts to receive large binary uploads
 * (Docker tarballs, build contexts) without loading them entirely into memory.
 */

import { createWriteStream, mkdirSync, existsSync } from "node:fs";

/**
 * Stream a ReadableStream body to a file on disk.
 *
 * @param body - The request body ReadableStream
 * @param destPath - Absolute path where the file should be written
 * @returns Promise that resolves when the file is fully written
 */
export async function streamBodyToFile(body: ReadableStream, destPath: string): Promise<void> {
  const dir = destPath.substring(0, destPath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const writeStream = createWriteStream(destPath);
  const reader = body.getReader();

  await new Promise<void>((resolve, reject) => {
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
          if (done) {
            writeStream.end();
            break;
          }
          writeStream.write(value);
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    void pump();
  });
}
