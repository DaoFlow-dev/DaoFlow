import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const getKey = () =>
  createHash("sha256")
    .update(
      process.env.ENCRYPTION_KEY ??
        process.env.BETTER_AUTH_SECRET ??
        "daoflow-local-control-plane"
    )
    .digest();

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
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function displayValue(encryptedValue: string, isSecret: boolean): string {
  return isSecret ? "[secret]" : decrypt(encryptedValue);
}
