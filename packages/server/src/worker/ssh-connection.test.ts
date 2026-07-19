import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sshHostKeyFingerprint } from "./ssh-host-key-scan";
import type { SSHTarget } from "./ssh-connection";

const publicKey = "AQIDBA==";
const target: SSHTarget = {
  serverName: "prod-eu",
  host: "example.com",
  port: 2222,
  user: "debian",
  hostIdentity: {
    teamId: "team_foundation",
    serverId: "srv_prod_eu",
    algorithm: "ssh-ed25519",
    publicKey,
    fingerprint: sshHostKeyFingerprint(publicKey)
  }
};

const envKeys = ["SSH_CONTROL_DIR", "SSH_KEY_DIR", "SSH_KNOWN_HOSTS_DIR"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<
  (typeof envKeys)[number],
  string | undefined
>;

afterEach(() => {
  vi.useRealTimers();
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

async function loadSSHFileTransferModule() {
  return import("./ssh-file-transfer");
}

function createSSHFixture() {
  const rootDir = mkdtempSync(join(tmpdir(), "daoflow-ssh-connection-"));
  const controlDir = join(rootDir, "control");
  const keyDir = join(rootDir, "keys");
  const knownHostsDir = join(rootDir, "known-hosts");
  mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  mkdirSync(knownHostsDir, { recursive: true, mode: 0o700 });
  return { rootDir, controlDir, keyDir, knownHostsDir };
}

describe("sshArgs", () => {
  it("builds the shared SSH transport arguments and appends the destination", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
    writeFileSync(join(fixture.keyDir, "id_ed25519"), "test-private-key");

    vi.resetModules();
    const { sshArgs } = await loadSSHConnectionModule();
    const args = sshArgs(target);

    expect(args).toContain("-p");
    expect(args).toContain("2222");
    expect(args).toContain("-i");
    expect(args).toContain(join(fixture.keyDir, "id_ed25519"));
    expect(args).toContain("debian@example.com");
    const knownHostsPath = join(
      fixture.knownHostsDir,
      "team_foundation",
      "srv_prod_eu.known_hosts"
    );
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain(`UserKnownHostsFile=${knownHostsPath}`);
    expect(args).toContain(`GlobalKnownHostsFile=${knownHostsPath}`);
    expect(args).toContain("UpdateHostKeys=no");
    expect(readFileSync(knownHostsPath, "utf8")).toBe(
      `[example.com]:2222 ssh-ed25519 ${publicKey}\n`
    );
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ServerAliveInterval=15");
    expect(args.some((arg) => arg.startsWith(`ControlPath=${fixture.controlDir}/cm-`))).toBe(true);
    expect(args.find((arg) => arg.startsWith("ControlPath="))).not.toContain("example.com");
  });

  it("omits the identity flag when no key file is available", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;

    const { sshArgs } = await loadSSHConnectionModule();
    const args = sshArgs(target);

    expect(args).not.toContain("-i");
  });

  it("reads SSH directories dynamically instead of freezing them at module load", async () => {
    const firstFixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = firstFixture.controlDir;
    process.env.SSH_KEY_DIR = firstFixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = firstFixture.knownHostsDir;

    const { sshArgs } = await loadSSHConnectionModule();

    const secondFixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = secondFixture.controlDir;
    process.env.SSH_KEY_DIR = secondFixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = secondFixture.knownHostsDir;
    const keyPath = join(secondFixture.keyDir, "id_ed25519");
    writeFileSync(keyPath, "test-private-key");

    const args = sshArgs(target);

    expect(args).toContain("-i");
    expect(args).toContain(keyPath);
    expect(args.some((arg) => arg.startsWith(`ControlPath=${secondFixture.controlDir}/cm-`))).toBe(
      true
    );
  });
});

describe("SCP file transfer", () => {
  it("reuses the same transport contract with SCP-specific port handling", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
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

    const { scpUpload } = await loadSSHFileTransferModule();
    await scpUpload(target, "/tmp/local.tgz", "/srv/app/local.tgz", () => undefined);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(args).toContain("-P");
    expect(args).toContain("2222");
    expect(args).toContain("-i");
    expect(args).toContain(join(fixture.keyDir, "id_ed25519"));
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("UpdateHostKeys=no");
    expect(args.some((arg) => arg.startsWith(`ControlPath=${fixture.controlDir}/cm-`))).toBe(true);
    expect(args).toContain("/tmp/local.tgz");
    expect(args).toContain("debian@example.com:/srv/app/local.tgz");
  });

  it("fails before spawning SCP when the approved host key data is corrupted", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
    const spawnMock = vi.fn();

    vi.doMock("node:child_process", async () => {
      const actual =
        await vi.importActual<typeof import("node:child_process")>("node:child_process");
      return { ...actual, spawn: spawnMock };
    });

    const { scpUpload } = await loadSSHFileTransferModule();
    await expect(
      scpUpload(
        {
          ...target,
          hostIdentity: { ...target.hostIdentity!, fingerprint: "SHA256:not-the-key" }
        },
        "/tmp/local.tgz",
        "/srv/app/local.tgz",
        () => undefined
      )
    ).rejects.toThrow("fingerprint does not match");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("downloads through the same pinned transport and never exceeds the transfer ceiling", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
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
      return { ...actual, spawn: spawnMock };
    });

    const { MAX_SCP_TRANSFER_TIMEOUT_MS, scpDownload } = await loadSSHFileTransferModule();
    await scpDownload(target, "/srv/app/backup.tar", "/tmp/backup.tar", () => undefined, {
      timeoutMs: MAX_SCP_TRANSFER_TIMEOUT_MS + 1
    });

    const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("debian@example.com:/srv/app/backup.tar");
    expect(args).toContain("/tmp/backup.tar");
  });

  it("terminates a stuck download when its bounded timeout expires", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
    const kill = vi.fn();
    const spawnMock = vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill,
      on: vi.fn()
    }));
    vi.doMock("node:child_process", async () => {
      const actual =
        await vi.importActual<typeof import("node:child_process")>("node:child_process");
      return { ...actual, spawn: spawnMock };
    });

    const { scpDownload } = await loadSSHFileTransferModule();
    await expect(
      scpDownload(target, "/srv/app/backup.tar", "/tmp/backup.tar", () => undefined, {
        timeoutMs: 1
      })
    ).rejects.toThrow("timed out after 1ms");
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("terminates a transfer when the caller cancels it", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
    const kill = vi.fn();
    const spawnMock = vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill,
      on: vi.fn()
    }));
    vi.doMock("node:child_process", async () => {
      const actual =
        await vi.importActual<typeof import("node:child_process")>("node:child_process");
      return { ...actual, spawn: spawnMock };
    });

    const controller = new AbortController();
    const { scpDownload } = await loadSSHFileTransferModule();
    const download = scpDownload(
      target,
      "/srv/app/backup.tar",
      "/tmp/backup.tar",
      () => undefined,
      { signal: controller.signal }
    );

    controller.abort();
    await expect(download).rejects.toThrow("SCP transfer was cancelled.");
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("host identity guard", () => {
  it("refuses to build SSH arguments before credentials or commands can be sent", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;

    const { sshArgs } = await loadSSHConnectionModule();
    expect(() => sshArgs({ ...target, hostIdentity: undefined })).toThrow("not approved");
  });

  it("rejects an insecure trust-store directory before writing a known_hosts file", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
    chmodSync(fixture.knownHostsDir, 0o777);

    const { sshArgs } = await loadSSHConnectionModule();
    expect(() => sshArgs(target)).toThrow("permissions 700");
  });

  it("rejects an insecure or symlinked SSH control directory", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    chmodSync(fixture.controlDir, 0o777);

    const { sshArgs } = await loadSSHConnectionModule();
    expect(() => sshArgs(target)).toThrow("permissions 700");

    const secondFixture = createSSHFixture();
    const linkedControlDir = join(secondFixture.controlDir, "linked");
    symlinkSync(fixture.controlDir, linkedControlDir);
    process.env.SSH_CONTROL_DIR = linkedControlDir;
    process.env.SSH_KNOWN_HOSTS_DIR = secondFixture.knownHostsDir;
    expect(() => sshArgs(target)).toThrow("not a symbolic link");
  });

  it("rejects a known_hosts symlink without changing its target", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_CONTROL_DIR = fixture.controlDir;
    process.env.SSH_KEY_DIR = fixture.keyDir;
    process.env.SSH_KNOWN_HOSTS_DIR = fixture.knownHostsDir;
    const teamDir = join(fixture.knownHostsDir, "team_foundation");
    const victimPath = join(fixture.knownHostsDir, "victim");
    const knownHostsPath = join(teamDir, "srv_prod_eu.known_hosts");
    mkdirSync(teamDir, { mode: 0o700 });
    writeFileSync(victimPath, "do-not-replace", { mode: 0o600 });
    symlinkSync(victimPath, knownHostsPath);

    const { sshArgs } = await loadSSHConnectionModule();
    expect(() => sshArgs(target)).toThrow("not a link");
    expect(readFileSync(victimPath, "utf8")).toBe("do-not-replace");
  });
});

describe("temporary SSH private keys", () => {
  it("creates a private regular file inside an owner-only directory", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_KEY_DIR = fixture.keyDir;

    const { removeSSHKey, writeSSHKey } = await loadSSHConnectionModule();
    const keyPath = writeSSHKey("prod/eu", "test-private-key");
    const stats = lstatSync(keyPath);

    expect(keyPath.startsWith(`${fixture.keyDir}/prod_eu-`)).toBe(true);
    expect(stats.isFile()).toBe(true);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.nlink).toBe(1);
    expect(stats.mode & 0o777).toBe(0o600);
    expect(readFileSync(keyPath, "utf8")).toBe("test-private-key\n");

    removeSSHKey(keyPath);
    expect(() => lstatSync(keyPath)).toThrow();
  });

  it("rejects insecure and symlinked private-key directories", async () => {
    const fixture = createSSHFixture();
    process.env.SSH_KEY_DIR = fixture.keyDir;
    chmodSync(fixture.keyDir, 0o777);

    const { writeSSHKey } = await loadSSHConnectionModule();
    expect(() => writeSSHKey("prod", "secret")).toThrow("permissions 700");

    const secondFixture = createSSHFixture();
    const linkedKeyDir = join(secondFixture.rootDir, "linked-keys");
    symlinkSync(fixture.keyDir, linkedKeyDir);
    process.env.SSH_KEY_DIR = linkedKeyDir;
    expect(() => writeSSHKey("prod", "secret")).toThrow("not a symbolic link");
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
