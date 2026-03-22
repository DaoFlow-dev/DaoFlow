import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BackupProvider } from "../db/schema/destinations";
import {
  DEFAULT_LOCAL_RCLONE_PATH,
  DEFAULT_RCLONE_REMOTE_NAME,
  ENCRYPTED_RCLONE_REMOTE_NAME,
  resolveRemotePath
} from "./rclone-helpers";
import { processRunner } from "./process-runner";

export interface DestinationConfig {
  id: string;
  provider: BackupProvider;
  accessKey?: string | null;
  secretAccessKey?: string | null;
  bucket?: string | null;
  region?: string | null;
  endpoint?: string | null;
  s3Provider?: string | null;
  rcloneType?: string | null;
  rcloneConfig?: string | null;
  rcloneRemotePath?: string | null;
  oauthToken?: string | null;
  encryptionMode?: string | null;
  encryptionPassword?: string | null;
  encryptionSalt?: string | null;
  filenameEncryption?: string | null;
  localPath?: string | null;
}

function obscurePassword(password: string): string {
  try {
    const result = processRunner.execFileSync("rclone", ["obscure", password], {
      encoding: "utf-8",
      timeout: 10_000
    }) as unknown as string;
    return (result ?? "").trim();
  } catch {
    return password;
  }
}

export function generateRcloneConfig(dest: DestinationConfig): string {
  const configPath = join(
    tmpdir(),
    `daoflow-rclone-${dest.id}-${randomBytes(8).toString("hex")}.conf`
  );
  let configContent = "";

  switch (dest.provider) {
    case "s3":
      configContent = buildS3Config(dest);
      break;
    case "gdrive":
      configContent = buildOAuthConfig("drive", dest);
      break;
    case "onedrive":
      configContent = buildOAuthConfig("onedrive", dest);
      break;
    case "dropbox":
      configContent = buildOAuthConfig("dropbox", dest);
      break;
    case "sftp":
      configContent = buildSftpConfig(dest);
      break;
    case "local":
      configContent = buildLocalConfig(dest);
      break;
    case "rclone":
      configContent = dest.rcloneConfig ?? "";
      break;
    default:
      throw new Error(`Unsupported provider: ${String(dest.provider)}`);
  }

  writeFileSync(configPath, configContent, { mode: 0o600 });

  if (dest.encryptionMode === "rclone-crypt" && dest.encryptionPassword) {
    appendFileSync(configPath, buildCryptOverlay(dest), { mode: 0o600 });
  }

  return configPath;
}

function buildS3Config(dest: DestinationConfig): string {
  const lines = [
    `[${DEFAULT_RCLONE_REMOTE_NAME}]`,
    `type = s3`,
    dest.s3Provider ? `provider = ${dest.s3Provider}` : "",
    dest.accessKey ? `access_key_id = ${dest.accessKey}` : "",
    dest.secretAccessKey ? `secret_access_key = ${dest.secretAccessKey}` : "",
    dest.region ? `region = ${dest.region}` : "",
    dest.endpoint ? `endpoint = ${dest.endpoint}` : "",
    `force_path_style = true`,
    `no_check_bucket = true`
  ];
  return lines.filter(Boolean).join("\n") + "\n";
}

function buildOAuthConfig(rcloneType: string, dest: DestinationConfig): string {
  const lines = [
    `[${DEFAULT_RCLONE_REMOTE_NAME}]`,
    `type = ${rcloneType}`,
    dest.oauthToken ? `token = ${dest.oauthToken}` : ""
  ];
  return lines.filter(Boolean).join("\n") + "\n";
}

function buildSftpConfig(dest: DestinationConfig): string {
  if (dest.rcloneConfig) {
    return dest.rcloneConfig;
  }
  return `[${DEFAULT_RCLONE_REMOTE_NAME}]\ntype = sftp\n`;
}

function buildLocalConfig(dest: DestinationConfig): string {
  const localPath = dest.localPath ?? DEFAULT_LOCAL_RCLONE_PATH;
  if (!existsSync(localPath)) {
    mkdirSync(localPath, { recursive: true });
  }
  return `[${DEFAULT_RCLONE_REMOTE_NAME}]\ntype = local\n`;
}

function buildCryptOverlay(dest: DestinationConfig): string {
  const baseRemote = resolveRemotePath(dest);
  const obscuredPw = obscurePassword(dest.encryptionPassword ?? "");
  const filenameEnc = dest.filenameEncryption ?? "standard";

  const lines = [
    `\n[${ENCRYPTED_RCLONE_REMOTE_NAME}]`,
    `type = crypt`,
    `remote = ${baseRemote}`,
    `password = ${obscuredPw}`,
    dest.encryptionSalt ? `password2 = ${obscurePassword(dest.encryptionSalt)}` : "",
    `filename_encryption = ${filenameEnc}`,
    `directory_name_encryption = true`
  ];
  return lines.filter(Boolean).join("\n") + "\n";
}
