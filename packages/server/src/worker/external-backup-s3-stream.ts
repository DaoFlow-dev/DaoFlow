import { createHash } from "node:crypto";
import { createWriteStream, rmSync } from "node:fs";
import { once } from "node:events";
import { ExternalS3Error, type ExternalS3OperationHooks } from "./external-backup-s3-types";

const S3_METADATA_TIMEOUT_MS = Number(
  process.env.DAOFLOW_EXTERNAL_S3_METADATA_TIMEOUT_MS ?? 15_000
);

export async function sendS3Metadata<T>(
  run: (signal: AbortSignal) => Promise<T>,
  message: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), S3_METADATA_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (error) {
    throw new ExternalS3Error(message, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export async function streamPinnedObjectToFile(input: {
  body: unknown;
  contentLength: number | undefined;
  expectedSize: number;
  maxBytes: number;
  destinationPath: string;
  hooks: ExternalS3OperationHooks;
}): Promise<{ sha256: string; bytes: number }> {
  if (input.contentLength !== undefined && input.contentLength !== input.expectedSize) {
    throw new ExternalS3Error("Pinned external backup object size changed before download.");
  }
  if (input.expectedSize > input.maxBytes) {
    throw new ExternalS3Error("External backup object exceeds the configured import size limit.");
  }
  const body = input.body as AsyncIterable<Uint8Array> | undefined;
  if (!body || typeof body[Symbol.asyncIterator] !== "function") {
    throw new ExternalS3Error("Pinned external backup object has no readable response body.");
  }

  const hash = createHash("sha256");
  let bytes = 0;
  const output = createWriteStream(input.destinationPath, { flags: "wx", mode: 0o600 });
  let streamError: Error | null = null;
  const readStreamError = (): Error | null => streamError;
  const closed = once(output, "close");
  output.on("error", (error) => {
    streamError = error;
  });
  try {
    for await (const chunk of body) {
      if (input.hooks.cancellationSignal?.aborted) {
        throw new ExternalS3Error("Pinned external backup download was cancelled.");
      }
      input.hooks.heartbeat?.();
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > input.maxBytes || bytes > input.expectedSize) {
        throw new ExternalS3Error("External backup object exceeded its approved byte limit.");
      }
      hash.update(buffer);
      if (!output.write(buffer)) {
        await Promise.race([once(output, "drain"), closed]);
        const writeError = readStreamError();
        if (writeError) throw writeError;
      }
    }
    output.end();
    await Promise.race([once(output, "finish"), closed]);
    const finishError = readStreamError();
    if (finishError) throw finishError;
  } catch (error) {
    output.destroy();
    await closed;
    rmSync(input.destinationPath, { force: true });
    if (error instanceof ExternalS3Error) throw error;
    throw new ExternalS3Error("Pinned external backup object could not be written safely.");
  }
  if (bytes !== input.expectedSize) {
    rmSync(input.destinationPath, { force: true });
    throw new ExternalS3Error(
      "Pinned external backup object size did not match its approved metadata."
    );
  }
  return { sha256: hash.digest("hex"), bytes };
}
