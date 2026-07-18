import { describe, expect, it } from "vitest";
import { encryptWithKeyMaterial, getEncryptionKeyId } from "../crypto";
import {
  decryptDestinationCredentials,
  redactDestinationCredentialValues
} from "./destination-credentials";

const keyMaterial = "destination-credential-test-key-material";

describe("destination credential safety", () => {
  it("redacts every non-empty credential, including values shorter than four characters", () => {
    const credentials = {
      accessKey: "x",
      secretAccessKey: "yz",
      encryptionPassword: "uvw"
    };

    expect(redactDestinationCredentialValues("access=x secret=yz password=uvw", credentials)).toBe(
      "access=[redacted] secret=[redacted] password=[redacted]"
    );
  });

  it("does not expose decrypted plaintext or parser content for malformed envelopes", () => {
    const plaintext = "malformed-secret-plaintext";
    const encrypted = encryptWithKeyMaterial(plaintext, keyMaterial);
    const row = {
      credentialsEncrypted: encrypted,
      credentialEnvelopeVersion: 1,
      credentialKeyId: getEncryptionKeyId(keyMaterial)
    };

    let thrown: unknown;
    try {
      decryptDestinationCredentials(row, keyMaterial);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Destination credential envelope payload is invalid.");
    expect((thrown as Error).message).not.toContain(plaintext);
  });
});
