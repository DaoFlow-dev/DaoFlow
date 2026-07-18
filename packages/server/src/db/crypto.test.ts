import { describe, expect, test } from "vitest";
import { decrypt, encrypt, resolveEncryptionKeyMaterial } from "./crypto";

describe("crypto configuration", () => {
  test("requires a dedicated encryption key in production", () => {
    expect(() =>
      resolveEncryptionKeyMaterial({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "auth-secret-is-not-the-encryption-key"
      })
    ).toThrow("ENCRYPTION_KEY must be set in production.");
  });

  test("requires a strong encryption key in production", () => {
    expect(() =>
      resolveEncryptionKeyMaterial({
        NODE_ENV: "production",
        ENCRYPTION_KEY: "short-key"
      })
    ).toThrow("ENCRYPTION_KEY must be at least 32 characters in production.");
  });

  test("allows local development fallback when no encryption key is configured", () => {
    expect(resolveEncryptionKeyMaterial({ NODE_ENV: "development" })).toBe(
      "daoflow-local-encryption-key-please-change-2026"
    );
  });

  test("round-trips encrypted values with the configured key", () => {
    const originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "test-encryption-key";

    try {
      const encrypted = encrypt("super-secret-value");
      expect(decrypt(encrypted)).toBe("super-secret-value");
    } finally {
      if (originalKey === undefined) {
        delete process.env.ENCRYPTION_KEY;
      } else {
        process.env.ENCRYPTION_KEY = originalKey;
      }
    }
  });
});
