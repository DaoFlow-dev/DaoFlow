import { describe, expect, it } from "vitest";
import { parseSshHostKeyScan } from "./ssh-host-key-scan";

describe("parseSshHostKeyScan", () => {
  it("accepts modern SSH host keys and rejects obsolete DSA material", () => {
    const keys = parseSshHostKeyScan(`
example.com ssh-dss AQIDBA==
example.com ssh-ed25519 BQYHCA==
example.com ecdsa-sha2-nistp256 CQoLDA==
example.com ssh-rsa DQ4PEA==
`);

    expect(keys.map((key) => key.algorithm)).toEqual([
      "ecdsa-sha2-nistp256",
      "ssh-ed25519",
      "ssh-rsa"
    ]);
  });
});
