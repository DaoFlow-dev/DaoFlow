export type ExternalS3Destination = {
  id: string;
  provider: string;
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  accessKey: string | null;
  secretAccessKey: string | null;
  encryptionMode: string;
  externalImportEnabled: boolean;
  externalImportPrefix: string | null;
  maxExternalImportBytes: string;
};

export type ExternalS3ObjectIdentity = {
  key: string;
  versionId: string | null;
  etag: string | null;
  size: number;
  contentType: string | null;
  lastModified: Date | null;
};

export type ExternalS3ObjectView = {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
  versionId: string | null;
};

export type ExternalS3OperationHooks = {
  heartbeat?: () => void;
  cancellationSignal?: AbortSignal;
};

export class ExternalS3Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalS3Error";
  }
}
