import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SSHTarget } from "./ssh-connection";

const target: SSHTarget = {
  serverName: "prod-eu",
  host: "example.com",
  port: 2222,
  user: "debian"
};

const envKeys = ["SSH_CONTROL_DIR", "SSH_KEY_DIR"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<
  (typeof envKeys)[number],
  string | undefined
>;

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:child_process");
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function loadSSHConnectionModule() {
  return import("./ssh-connection");
}

function createSSHFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "daoflow-ssh-connection-"));
  const controlDir = join(rootDir, "control");
  const keyDir = join(rootDir, "keys");
  mkdirSync(controlDir, { recursive: true });
  mkdirSync(keyDir, { recursive: true });
  return { controlDir, keyDir };
}

describe("sshArgs", () => {
  it("builds the shared SSH transport arguments and appends the destination", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    writeFileSync(join(fixture.keyDir, "id_ed25519"), "test-private-key");

    const { sshArgs } = await loadSSHConnectionModule();
    const args = sshArgs(target);

    expect(args).toContain("-p");
    expect(args).toContain("2222");
    expect(args).toContain("-i");
    expect(args).toContain(join(fixture.keyDir, "id_ed25519"));
    expect(args).toContain("debian@example.com");
    expect(args).toContain("StrictHostKeyChecking=accept-new");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ServerAliveInterval=15");
    expect(args).toContain(`ControlPath=${join(fixture.controlDir, "%h-%p-%r")}`);
  });

  it("omits the identity flag when no key file is available", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;

    const { sshArgs } = await loadSSHConnectionModule();
    const args = sshArgs(target);

    expect(args).not.toContain("-i");
  });

  it("reads SSH directories dynamically instead of freezing them at module load", async () => {
    const firstFixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = firstFixture.controlDir;
    process.env.SSH_KEY_DIR = firstFixture.keyDir;

    const { sshArgs } = await loadSSHConnectionModule();

    const secondFixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = secondFixture.controlDir;
    process.env.SSH_KEY_DIR = secondFixture.keyDir;
    const keyPath = join(secondFixture.keyDir, "id_ed25519");
    writeFileSync(keyPath, "test-private-key");

    const args = sshArgs(target);

    expect(args).toContain("-i");
    expect(args).toContain(keyPath);
    expect(args).toContain(`ControlPath=${join(secondFixture.controlDir, "%h-%p-%r")}`);
  });
});

describe("scpUpload", () => {
  it("reuses the same transport contract with SCP-specific port handling", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    writeFileSync(join(fixture.keyDir, "id_ed25519"), "test-private-key");

    const spawnMock = vi.fn(() => {
      const listeners = new Map<string, (...args: unknown[]) => void>();
      return {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          listeners.set(event, handler);
          if (event === "close") {
            queueMicrotask(() => handler(0, null));
          }
        })
      };
    });

    vi.doMock("node:child_process", async () => {
      const actual =
        await vi.importActual<typeof import("node:child_process")>("node:child_process");
      return {
        ...actual,
        spawn: spawnMock
      };
    });

    const { scpUpload } = await loadSSHConnectionModule();
    await scpUpload(target, "/tmp/local.tgz", "/srv/app/local.tgz", () => undefined);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(args).toContain("-P");
    expect(args).toContain("2222");
    expect(args).toContain("-i");
    expect(args).toContain(join(fixture.keyDir, "id_ed25519"));
    expect(args).toContain(`ControlPath=${join(fixture.controlDir, "%h-%p-%r")}`);
    expect(args).toContain("/tmp/local.tgz");
    expect(args).toContain("debian@example.com:/srv/app/local.tgz");
  });
});

describe("shellQuote", () => {
  it("escapes embedded single quotes for POSIX shells", async () => {
    const { shellQuote } = await loadSSHConnectionModule();
    expect(shellQuote("don't panic")).toBe("'don'\"'\"'t panic'");
  });

  it("rejects shell arguments that are too large to quote safely", async () => {
    const { shellQuote } = await loadSSHConnectionModule();
    expect(() => shellQuote("x".repeat(4097))).toThrow("Input too long for shell argument");
  });
});
