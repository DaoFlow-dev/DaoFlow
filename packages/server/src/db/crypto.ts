import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const MIN_PRODUCTION_ENCRYPTION_KEY_LENGTH = 32;

export function resolveEncryptionKeyMaterial(env: NodeJS.ProcessEnv = process.env): string {
  const encryptionKey = env.ENCRYPTION_KEY?.trim();
  if (encryptionKey) {
    if (
      env.NODE_ENV === "production" &&
      encryptionKey.length < MIN_PRODUCTION_ENCRYPTION_KEY_LENGTH
    ) {
      throw new Error("ENCRYPTION_KEY must be at least 32 characters in production.");
    }

    return encryptionKey;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY must be set in production.");
  }

  return "daoflow-local-encryption-key-please-change-2026";
}

export function validateEncryptionConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  resolveEncryptionKeyMaterial(env);
}

const getKey = () => createHash("sha256").update(resolveEncryptionKeyMaterial()).digest();

export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Invalid encrypted payload.");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString(
    "utf8"
  );
}

export function displayValue(
  encryptedValue: string,
  isSecret: boolean,
  revealSecretValue = false
): string {
  if (isSecret && !revealSecretValue) {
    return "[secret]";
  }

  return decrypt(encryptedValue);
}
