export const DESTINATION_PROVIDERS = [
  { key: "s3", name: "S3-Compatible Storage", icon: "☁️" },
  { key: "gdrive", name: "Google Drive", icon: "📁" },
  { key: "onedrive", name: "Microsoft OneDrive", icon: "📂" },
  { key: "dropbox", name: "Dropbox", icon: "📦" },
  { key: "sftp", name: "SFTP / SSH", icon: "🔒" },
  { key: "local", name: "Local Filesystem", icon: "💾" },
  { key: "rclone", name: "Custom Rclone Config", icon: "⚙️" }
] as const;

export type ProviderKey = (typeof DESTINATION_PROVIDERS)[number]["key"];

export interface DestinationProviderMetadata {
  key: ProviderKey;
  name: string;
  icon: string;
  rcloneType: string;
  defaultName: string;
  authorizeCmd?: string;
}

export const DESTINATION_PROVIDER_METADATA: Record<ProviderKey, DestinationProviderMetadata> = {
  s3: {
    key: "s3",
    name: "S3-Compatible Storage",
    icon: "☁️",
    rcloneType: "s3",
    defaultName: "s3-backup"
  },
  gdrive: {
    key: "gdrive",
    name: "Google Drive",
    icon: "📁",
    rcloneType: "drive",
    authorizeCmd: 'rclone authorize "drive"',
    defaultName: "gdrive-backup"
  },
  onedrive: {
    key: "onedrive",
    name: "Microsoft OneDrive",
    icon: "📂",
    rcloneType: "onedrive",
    authorizeCmd: 'rclone authorize "onedrive"',
    defaultName: "onedrive-backup"
  },
  dropbox: {
    key: "dropbox",
    name: "Dropbox",
    icon: "📦",
    rcloneType: "dropbox",
    authorizeCmd: 'rclone authorize "dropbox"',
    defaultName: "dropbox-backup"
  },
  sftp: {
    key: "sftp",
    name: "SFTP / SSH",
    icon: "🔒",
    rcloneType: "sftp",
    defaultName: "sftp-backup"
  },
  local: {
    key: "local",
    name: "Local Filesystem",
    icon: "💾",
    rcloneType: "local",
    defaultName: "local-backup"
  },
  rclone: {
    key: "rclone",
    name: "Custom Rclone Config",
    icon: "⚙️",
    rcloneType: "custom",
    defaultName: "rclone-remote"
  }
};

export const S3_SUB_PROVIDERS = [
  { key: "AWS", name: "Amazon Web Services (AWS) S3" },
  { key: "Cloudflare", name: "Cloudflare R2" },
  { key: "DigitalOcean", name: "DigitalOcean Spaces" },
  { key: "GCS", name: "Google Cloud Storage" },
  { key: "Minio", name: "MinIO" },
  { key: "Wasabi", name: "Wasabi" },
  { key: "Other", name: "Any S3-compatible provider" }
] as const;

export function getDestinationProviderMetadata(provider: ProviderKey): DestinationProviderMetadata {
  return DESTINATION_PROVIDER_METADATA[provider];
}

export function isOAuthProvider(
  provider: ProviderKey
): provider is "gdrive" | "onedrive" | "dropbox" {
  return provider === "gdrive" || provider === "onedrive" || provider === "dropbox";
}

export function usesRemoteConfig(provider: ProviderKey): provider is "rclone" | "sftp" {
  return provider === "rclone" || provider === "sftp";
}
