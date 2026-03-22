import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readExistingInstall } from "./installer-lifecycle";

describe("readExistingInstall", () => {
  test("does not treat the public HTTPS URL as the local dashboard port", () => {
    const installDir = mkdtempSync(join(tmpdir(), "daoflow-existing-install-"));

    try {
      writeFileSync(
        join(installDir, ".env"),
        [
          "DAOFLOW_VERSION=0.5.5",
          "BETTER_AUTH_URL=https://deploy.example.com",
          "DAOFLOW_INITIAL_ADMIN_EMAIL=owner@example.com",
          "DAOFLOW_INITIAL_ADMIN_PASSWORD=secret-123"
        ].join("\n")
      );

      const existingInstall = readExistingInstall(installDir);
      expect(existingInstall?.domain).toBe("deploy.example.com");
      expect(existingInstall?.scheme).toBe("https");
      expect(existingInstall?.port).toBeUndefined();
    } finally {
      rmSync(installDir, { recursive: true, force: true });
    }
  });
});
