import type { ProviderKey } from "./add-destination-provider-config";

export interface DestinationFormData {
  name: string;
  provider: ProviderKey;
  accessKey?: string;
  secretAccessKey?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  s3Provider?: string;
  localPath?: string;
  rcloneConfig?: string;
  rcloneRemotePath?: string;
  oauthToken?: string;
  externalImportEnabled?: boolean;
  externalImportPrefix?: string;
  maxExternalImportBytes?: number;
}

export interface AddDestinationFormState {
  name: string;
  provider: ProviderKey;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
  endpoint: string;
  s3Provider: string;
  localPath: string;
  rcloneConfig: string;
  rcloneRemotePath: string;
  externalImportEnabled: boolean;
  externalImportPrefix: string;
  maxExternalImportBytes: string;
}
