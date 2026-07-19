import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type ListObjectsV2CommandOutput
} from "@aws-sdk/client-s3";
import {
  assertObjectKeyWithinPrefix,
  normalizeEtag,
  normalizeExternalObjectKey,
  normalizeObjectIdentity,
  resolveExternalObjectPrefix,
  validateExternalS3Destination
} from "./external-backup-s3-validation";
import { sendS3Metadata, streamPinnedObjectToFile } from "./external-backup-s3-stream";
import {
  ExternalS3Error,
  type ExternalS3Destination,
  type ExternalS3ObjectIdentity,
  type ExternalS3ObjectView,
  type ExternalS3OperationHooks
} from "./external-backup-s3-types";

type S3Transport = {
  send(
    command: HeadObjectCommand,
    options?: { abortSignal?: AbortSignal }
  ): Promise<HeadObjectCommandOutput>;
  send(
    command: GetObjectCommand,
    options?: { abortSignal?: AbortSignal }
  ): Promise<GetObjectCommandOutput>;
  send(
    command: ListObjectsV2Command,
    options?: { abortSignal?: AbortSignal }
  ): Promise<ListObjectsV2CommandOutput>;
};

export function createExternalS3Adapter(
  destination: ExternalS3Destination,
  options: { client?: S3Transport } = {}
) {
  const config = validateExternalS3Destination(destination);
  const client = options.client ?? createS3Client(config);
  return {
    listObjects: async (requestedPrefix?: string) => {
      const prefix = resolveExternalObjectPrefix(config.externalImportPrefix, requestedPrefix);
      const output = await sendS3Metadata(
        (abortSignal) =>
          client.send(
            new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: 1000 }),
            { abortSignal }
          ),
        "External backup objects could not be listed."
      );
      const objects: ExternalS3ObjectView[] = (output.Contents ?? [])
        .flatMap((object) => {
          const { Key: key, Size: size } = object;
          if (
            !key ||
            !key.startsWith(prefix) ||
            typeof size !== "number" ||
            !Number.isSafeInteger(size) ||
            size < 0
          )
            return [];
          return [
            {
              key,
              name: key.slice(prefix.length).split("/").filter(Boolean).at(-1) ?? key,
              size,
              lastModified: object.LastModified?.toISOString() ?? null,
              etag: normalizeEtag(object.ETag),
              versionId: null
            }
          ];
        })
        .sort((left, right) => left.key.localeCompare(right.key));
      return { prefix, objects };
    },
    headObject: async (requestedKey: string) => {
      const key = normalizeExternalObjectKey(requestedKey);
      assertObjectKeyWithinPrefix(key, config.externalImportPrefix);
      const output = await sendS3Metadata(
        (abortSignal) =>
          client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal }),
        "External backup object could not be read."
      );
      return normalizeObjectIdentity(key, output, config.maxImportBytes);
    },
    downloadPinnedObject: async (
      object: ExternalS3ObjectIdentity,
      destinationPath: string,
      hooks: ExternalS3OperationHooks = {}
    ) => {
      assertObjectKeyWithinPrefix(object.key, config.externalImportPrefix);
      if (!object.versionId && !object.etag) {
        throw new ExternalS3Error("External backup object is missing a pinned version or ETag.");
      }
      let output: GetObjectCommandOutput;
      try {
        hooks.heartbeat?.();
        output = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: object.key,
            ...(object.versionId
              ? { VersionId: object.versionId }
              : { IfMatch: object.etag as string })
          }),
          { abortSignal: hooks.cancellationSignal }
        );
      } catch {
        throw new ExternalS3Error("Pinned external backup object could not be downloaded.");
      }
      return streamPinnedObjectToFile({
        body: output.Body,
        contentLength: output.ContentLength,
        expectedSize: object.size,
        maxBytes: config.maxImportBytes,
        destinationPath,
        hooks
      });
    }
  };
}

function createS3Client(
  destination: ReturnType<typeof validateExternalS3Destination>
): S3Transport {
  return new S3Client({
    region: destination.region?.trim() || "us-east-1",
    ...(destination.endpoint?.trim()
      ? { endpoint: destination.endpoint.trim(), forcePathStyle: true }
      : {}),
    credentials: {
      accessKeyId: destination.accessKey as string,
      secretAccessKey: destination.secretAccessKey as string
    }
  });
}

export {
  ExternalS3Error,
  normalizeExternalObjectKey,
  resolveExternalObjectPrefix,
  type ExternalS3Destination,
  type ExternalS3ObjectIdentity,
  type ExternalS3ObjectView,
  type ExternalS3OperationHooks
};
