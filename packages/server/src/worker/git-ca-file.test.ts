import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appendGitProviderCaConfig, withGitProviderCaFile } from "./git-ca-file";

function deferred() {
  let resolve: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve: () => resolve() };
}

describe("withGitProviderCaFile", () => {
  it("uses a unique owner-only file for each concurrent operation and removes both", async () => {
    const ready = deferred();
    const release = deferred();
    const paths: string[] = [];

    const operation = async (caFilePath: string | undefined) => {
      expect(caFilePath).toBeTypeOf("string");
      paths.push(caFilePath as string);
      if (paths.length === 2) {
        ready.resolve();
      }
      await release.promise;
    };

    const first = withGitProviderCaFile(
      "https://git.example.test/first.git",
      "-----BEGIN CERTIFICATE-----\nfirst\n-----END CERTIFICATE-----",
      operation
    );
    const second = withGitProviderCaFile(
      "https://git.example.test/second.git",
      "-----BEGIN CERTIFICATE-----\nsecond\n-----END CERTIFICATE-----",
      operation
    );

    await ready.promise;
    expect(new Set(paths)).toHaveLength(2);
    for (const caPath of paths) {
      expect((await stat(caPath)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(caPath))).mode & 0o777).toBe(0o700);
    }

    release.resolve();
    await Promise.all([first, second]);
    for (const caPath of paths) {
      expect(existsSync(caPath)).toBe(false);
      expect(existsSync(path.dirname(caPath))).toBe(false);
    }
  });

  it("removes the CA file after an operation failure or cancellation", async () => {
    let caPath = "";

    await expect(
      withGitProviderCaFile(
        "https://git.example.test/repository.git",
        "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
        async (filePath) => {
          caPath = filePath ?? "";
          throw new Error("operation cancelled");
        }
      )
    ).rejects.toThrow("operation cancelled");

    expect(existsSync(caPath)).toBe(false);
    expect(existsSync(path.dirname(caPath))).toBe(false);
  });

  it("rejects non-HTTPS repositories before creating a CA file", async () => {
    const operation = vi.fn();

    await expect(
      withGitProviderCaFile(
        "git@git.example.test:team/repository.git",
        "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
        operation
      )
    ).rejects.toThrow("only be used with an HTTPS repository URL");

    expect(operation).not.toHaveBeenCalled();
  });
});

describe("appendGitProviderCaConfig", () => {
  it("adds trust only to the operation Git config", () => {
    expect(
      appendGitProviderCaConfig(
        [{ key: "http.extraHeader", value: "Authorization: Bearer token" }],
        "/tmp/unique/provider-ca.pem"
      )
    ).toEqual([
      { key: "http.extraHeader", value: "Authorization: Bearer token" },
      { key: "http.sslCAInfo", value: "/tmp/unique/provider-ca.pem" }
    ]);
  });
});
