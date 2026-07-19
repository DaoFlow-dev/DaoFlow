import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExternalS3Adapter,
  ExternalS3Error,
  normalizeExternalObjectKey,
  resolveExternalObjectPrefix,
  type ExternalS3Destination
} from "./external-backup-s3";

const roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function destination(overrides: Partial<ExternalS3Destination> = {}): ExternalS3Destination {
  return {
    id: "dest_external_test",
    provider: "s3",
    bucket: "test-bucket",
    region: "us-east-1",
    endpoint: null,
    accessKey: "access-key",
    secretAccessKey: "secret-key",
    encryptionMode: "none",
    externalImportEnabled: true,
    externalImportPrefix: "approved/postgres/",
    maxExternalImportBytes: "2147483648",
    ...overrides
  };
}

function adapterWith(
  send: (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>
) {
  return createExternalS3Adapter(destination(), { client: { send } as never });
}

async function* chunks(values: string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

describe("external S3 adapter", () => {
  it("normalizes keys and prevents prefix escape", async () => {
    expect(normalizeExternalObjectKey("approved/postgres/db.dump")).toBe(
      "approved/postgres/db.dump"
    );
    expect(resolveExternalObjectPrefix("approved/postgres/", "nested")).toBe(
      "approved/postgres/nested/"
    );
    expect(() => normalizeExternalObjectKey("approved/../secret.dump")).toThrow(ExternalS3Error);
    await expect(
      adapterWith(async () => ({ ContentLength: 1, ETag: '"etag"' })).headObject("outside/db.dump")
    ).rejects.toThrow("outside the approved import prefix");
  });

  it("rejects disabled, encrypted, missing-identity, and oversized imports", async () => {
    expect(() => createExternalS3Adapter(destination({ externalImportEnabled: false }))).toThrow(
      "disabled"
    );
    expect(() => createExternalS3Adapter(destination({ encryptionMode: "rclone-crypt" }))).toThrow(
      "without archive or rclone encryption"
    );
    await expect(
      adapterWith(async () => ({ ContentLength: 1 })).headObject("approved/postgres/db.dump")
    ).rejects.toThrow("missing a version ID and ETag");
    await expect(
      createExternalS3Adapter(destination({ maxExternalImportBytes: "2" }), {
        client: { send: async () => ({ ContentLength: 3, ETag: '"etag"' }) } as never
      }).headObject("approved/postgres/db.dump")
    ).rejects.toThrow("exceeds the configured import size limit");
  });

  it("pins ETag downloads and verifies the streamed checksum", async () => {
    let request: GetObjectCommand | undefined;
    const adapter = adapterWith(async (command) => {
      if (command instanceof GetObjectCommand) {
        request = command;
        return { ContentLength: 3, Body: chunks(["abc"]) };
      }
      throw new Error("unexpected command");
    });
    const root = mkdtempSync(join(tmpdir(), "daoflow-external-s3-"));
    roots.push(root);
    const result = await adapter.downloadPinnedObject(
      {
        key: "approved/postgres/db.dump",
        versionId: null,
        etag: '"etag-123"',
        size: 3,
        contentType: "application/octet-stream",
        lastModified: null
      },
      join(root, "db.dump")
    );

    expect(request?.input.IfMatch).toBe('"etag-123"');
    expect(result).toEqual({
      bytes: 3,
      sha256: createHash("sha256").update("abc").digest("hex")
    });
    expect(readFileSync(join(root, "db.dump"), "utf8")).toBe("abc");
  });

  it("aborts a streamed download, removes the partial file, and does not expose credentials", async () => {
    const controller = new AbortController();
    const adapter = adapterWith(async () => ({ ContentLength: 6, Body: chunks(["abc", "def"]) }));
    const root = mkdtempSync(join(tmpdir(), "daoflow-external-s3-"));
    roots.push(root);
    const path = join(root, "db.dump");

    await expect(
      adapter.downloadPinnedObject(
        {
          key: "approved/postgres/db.dump",
          versionId: "version-1",
          etag: null,
          size: 6,
          contentType: null,
          lastModified: null
        },
        path,
        { heartbeat: () => controller.abort(), cancellationSignal: controller.signal }
      )
    ).rejects.toThrow("cancelled");
    expect(() => readFileSync(path)).toThrow();
  });

  it("bounds metadata calls with an abort signal and returns a safe error", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const adapter = adapterWith(
      (_command, options) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("https://access-key:secret-key@bad-endpoint"));
          });
        })
    );
    const request = adapter.headObject("approved/postgres/db.dump").then(
      () => {
        throw new Error("Expected the metadata request to fail.");
      },
      (caught: unknown) => caught
    );
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await request;
    expect(error).toBeInstanceOf(ExternalS3Error);
    if (!(error instanceof ExternalS3Error)) throw new Error("Expected ExternalS3Error.");
    expect(error.message).toBe("External backup object could not be read.");
    expect(error.cause).toEqual(
      expect.objectContaining({ message: "https://access-key:secret-key@bad-endpoint" })
    );
    expect(String(error)).not.toContain("secret-key");
    expect(aborted).toBe(true);
  });
});
