import { afterEach, describe, expect, it, vi } from "vitest";
import { processRunner } from "./process-runner";
import { archiveDecrypt, archiveEncrypt, copyToRemote, testConnection } from "./rclone-executor";
import {
  extractConfiguredRemoteName,
  normalizeExecutableFailure,
  parseRcloneLsOutput,
  resolveRemotePath
} from "./rclone-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rclone remote helpers", () => {
  it("uses the configured remote name for custom rclone configs", () => {
    expect(
      resolveRemotePath({
        provider: "rclone",
        rcloneConfig: "[remote]\ntype = sftp\nhost = backup.example.com\n",
        rcloneRemotePath: "backups/daoflow"
      })
    ).toBe("remote:backups/daoflow");
  });

  it("keeps encrypted remotes rooted at the crypt overlay", () => {
    expect(
      resolveRemotePath(
        {
          provider: "rclone",
          rcloneConfig: "[remote]\ntype = sftp\nhost = backup.example.com\n",
          rcloneRemotePath: "backups/daoflow",
          encryptionMode: "rclone-crypt",
          encryptionPassword: "secret"
        },
        "daily",
        true
      )
    ).toBe("daoflow-crypt:daily");
  });

  it("extracts the first configured remote section name", () => {
    expect(
      extractConfiguredRemoteName("\n[remote]\ntype = sftp\nhost = backup.example.com\n")
    ).toBe("remote");
    expect(extractConfiguredRemoteName("type = sftp")).toBeNull();
  });

  it("parses rclone ls output into file counts and bytes", () => {
    expect(parseRcloneLsOutput("  10 snapshots/a\ninvalid\n  25 snapshots/b\n")).toEqual({
      fileCount: 2,
      totalBytes: 35
    });
  });

  it("normalizes missing executable failures into a stable operator message", () => {
    const error = new Error('Executable not found in $PATH: "rclone"') as NodeJS.ErrnoException;
    error.code = "ENOENT";

    expect(normalizeExecutableFailure("rclone", error, "testing this backup destination")).toBe(
      'Executable not found in $PATH: "rclone". Install rclone in the current runtime before testing this backup destination.'
    );
  });
});

describe("rclone executor", () => {
  it("targets the configured remote name when copying through custom rclone configs", () => {
    const execFileSyncMock = vi.spyOn(processRunner, "execFileSync").mockImplementation(() => "");
    const result = copyToRemote(
      {
        id: "dest_custom_rclone",
        provider: "rclone",
        rcloneConfig: "[remote]\ntype = sftp\nhost = backup.example.com\n",
        rcloneRemotePath: "backups/daoflow"
      },
      "/tmp/source",
      "daily"
    );

    expect(result.success).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const call = execFileSyncMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("Expected rclone copy invocation.");
    }
    const [file, args] = call;
    expect(file).toBe("rclone");
    expect(args).toContain("copy");
    expect(args).toContain("/tmp/source");
    expect(args).toContain("remote:backups/daoflow/daily");
  });

  it("returns a clear error when the rclone executable is unavailable", () => {
    const error = new Error('Executable not found in $PATH: "rclone"') as NodeJS.ErrnoException & {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    error.code = "ENOENT";
    error.status = 127;

    vi.spyOn(processRunner, "execFileSync").mockImplementation(() => {
      throw error;
    });
    const result = testConnection({
      id: "dest_local_missing_rclone",
      provider: "local",
      localPath: "/tmp/daoflow-rclone-tests"
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.error).toBe(
      'Executable not found in $PATH: "rclone". Install rclone in the current runtime before running backup destination operations.'
    );
  });

  it("redacts destination credentials from rclone failures", () => {
    const error = Object.assign(new Error("rclone failed with secret-key-in-error"), {
      status: 1,
      stdout: "access-key-in-output",
      stderr: "secret-key-in-error"
    });
    vi.spyOn(processRunner, "execFileSync").mockImplementation(() => {
      throw error;
    });

    const result = testConnection({
      id: "dest_redacted_rclone",
      provider: "s3",
      accessKey: "access-key-in-output",
      secretAccessKey: "secret-key-in-error"
    });

    expect(`${result.output}\n${result.error}`).not.toContain("access-key-in-output");
    expect(`${result.output}\n${result.error}`).not.toContain("secret-key-in-error");
    expect(`${result.output}\n${result.error}`).toContain("[redacted]");
  });

  it("redacts archive passwords from encryption and restore failures", () => {
    vi.spyOn(processRunner, "execFileSync").mockImplementation(() => {
      throw new Error("Command failed: 7z -parchive-password-secret");
    });

    const encrypted = archiveEncrypt("/tmp/source", "archive-password-secret");
    const decrypted = archiveDecrypt("/tmp/archive.7z", "archive-password-secret", "/tmp/output");

    expect(encrypted.error).toContain("[redacted]");
    expect(decrypted.error).toContain("[redacted]");
    expect(encrypted.error).not.toContain("archive-password-secret");
    expect(decrypted.error).not.toContain("archive-password-secret");
  });
});
