import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  beforePostgresVerificationDeadline,
  makeVerificationContainer,
  POSTGRES_VERIFICATION_HEARTBEAT_INTERVAL_MS,
  verificationCommand
} from "./postgres-restore-verification-commands";
import {
  createPostgresRestoreVerifier,
  type PostgresRestoreVerificationCommand,
  type PostgresRestoreVerificationInput
} from "./postgres-restore-verification";

const roots: string[] = [];
const verifierImage = `postgres:16.4-bookworm@sha256:${"a".repeat(64)}`;

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

function createDump(contents = "custom-format-dump"): {
  path: string;
  checksum: string;
} {
  const root = mkdtempSync(join(tmpdir(), "daoflow-pg-verify-"));
  roots.push(root);
  const path = join(root, "database.dump");
  writeFileSync(path, contents);
  return { path, checksum: createHash("sha256").update(contents).digest("hex") };
}

function inputFor(dump: { path: string; checksum: string }): PostgresRestoreVerificationInput {
  return {
    restoreId: "brest_verify_1234567890",
    localDumpPath: dump.path,
    expectedSha256: dump.checksum,
    sourcePostgresVersion: "16.4",
    verifierImage
  };
}

function verifierHarness(
  options: {
    onCommand?: (command: PostgresRestoreVerificationCommand) => Promise<{ stdout: string }>;
    onStart?: () => void;
  } = {}
) {
  const commands: PostgresRestoreVerificationCommand[] = [];
  let now = 0;
  const verifier = createPostgresRestoreVerifier({
    now: () => now,
    completedAt: () => "2026-07-18T00:00:00.000Z",
    sleep: () => Promise.resolve(),
    runCommand: async (command) => {
      commands.push({ ...command, args: [...command.args] });
      if (command.args[0] === "start") options.onStart?.();
      if (options.onCommand) return options.onCommand(command);
      if (command.args[0] === "exec" && command.args.includes("psql")) {
        return { stdout: '{"schemas":2,"tables":3,"indexes":4,"functions":5}\n' };
      }
      return { stdout: "" };
    }
  });

  return {
    commands,
    verifier,
    advancePastTimeout: () => {
      now = 15 * 60 * 1000 + 1;
    }
  };
}

function findCommand(
  commands: PostgresRestoreVerificationCommand[],
  predicate: (command: PostgresRestoreVerificationCommand) => boolean
): PostgresRestoreVerificationCommand {
  const command = commands.find(predicate);
  if (!command) throw new Error("Expected Docker command was not issued.");
  return command;
}

describe("postgres restore verification", () => {
  it("fails preflight and checksum validation before Docker can create a verifier", async () => {
    const harness = verifierHarness();
    const missingResult = await harness.verifier.verify({
      ...inputFor({ path: join(tmpdir(), "missing-custom.dump"), checksum: "a".repeat(64) })
    });

    expect(missingResult.success).toBe(false);
    expect(missingResult.checks.input.status).toBe("failed");
    expect(harness.commands).toEqual([]);

    const dump = createDump();
    const checksumResult = await harness.verifier.verify({
      ...inputFor(dump),
      expectedSha256: "b".repeat(64)
    });

    expect(checksumResult.success).toBe(false);
    expect(checksumResult.checks.checksum.status).toBe("failed");
    expect(harness.commands).toEqual([]);

    const forbiddenInputResult = await harness.verifier.verify({
      ...inputFor(dump),
      containerName: "production-primary"
    } as PostgresRestoreVerificationInput);

    expect(forbiddenInputResult.success).toBe(false);
    expect(forbiddenInputResult.error).toContain("unsupported fields");
    expect(harness.commands).toEqual([]);
  });

  it("uses an isolated, resource-limited verifier with no mounts, ports, or live identifiers", async () => {
    const dump = createDump();
    const harness = verifierHarness();
    const result = await harness.verifier.verify(inputFor(dump));
    const create = findCommand(harness.commands, (command) => command.args[0] === "create");
    const inspection = findCommand(harness.commands, (command) => command.args[0] === "run");

    expect(result.success).toBe(true);
    expect(result.objectCounts).toEqual({ schemas: 2, tables: 3, indexes: 4, functions: 5 });
    expect(inspection.args).toContain("--network");
    expect(inspection.args[inspection.args.indexOf("--network") + 1]).toBe("none");
    expect(inspection.stdinPath).toBe(realpathSync(dump.path));
    expect(create.args).toEqual(
      expect.arrayContaining([
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--pids-limit",
        "128",
        "--cpus",
        "1.0",
        "--memory",
        "1g",
        "--memory-swap",
        "1g",
        "--tmpfs",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "com.daoflow.restore-verification=true",
        "com.daoflow.cleanup=required"
      ])
    );
    expect(
      create.args.some((arg) =>
        [
          "-p",
          "--publish",
          "--publish-all",
          "-v",
          "--volume",
          "--mount",
          "--volumes-from"
        ].includes(arg)
      )
    ).toBe(false);
    expect(create.args.join(" ")).not.toContain("production-primary");
    expect(create.args.join(" ")).not.toContain("live-postgres");

    const restore = findCommand(
      harness.commands,
      (command) => command.args[0] === "exec" && command.args.includes("pg_restore")
    );
    expect(restore.args).toEqual(
      expect.arrayContaining([
        "--format=custom",
        "--exit-on-error",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges"
      ])
    );
    expect(restore.args).not.toContain("--create");
    expect(restore.stdinPath).toBe(realpathSync(dump.path));
    const containerName = makeVerificationContainer(inputFor(dump).restoreId).name;
    expect(harness.commands.at(-1)?.args).toEqual(["rm", "--force", containerName]);
    expect(result.cleanup).toEqual({ attempted: true, containerRemoved: true });
  });

  it("derives verifier names from the restore and removes leftovers before a retry", async () => {
    const dump = createDump();
    const input = inputFor(dump);
    const first = verifierHarness();
    const second = verifierHarness();

    await first.verifier.verify(input);
    await second.verifier.verify(input);

    const expectedName = makeVerificationContainer(input.restoreId).name;
    const firstCleanup = first.commands.find(
      (command) => command.args[0] === "rm" && command.args[2] === expectedName
    );
    const firstCreate = findCommand(first.commands, (command) => command.args[0] === "create");
    const secondCreate = findCommand(second.commands, (command) => command.args[0] === "create");

    expect(firstCleanup).toBeDefined();
    expect(first.commands.indexOf(firstCleanup as PostgresRestoreVerificationCommand)).toBeLessThan(
      first.commands.indexOf(firstCreate)
    );
    expect(firstCreate.args).toContain(expectedName);
    expect(secondCreate.args).toContain(expectedName);
    expect(makeVerificationContainer("brest_verify_0987654321").name).not.toBe(expectedName);
  });

  it("heartbeats long commands and stops them when Temporal cancels the activity", async () => {
    const cancellation = new AbortController();
    let heartbeats = 0;
    const command = beforePostgresVerificationDeadline(
      {
        now: () => 0,
        completedAt: () => "2026-07-18T00:00:00.000Z",
        sleep: () => Promise.resolve(),
        heartbeat: () => {
          heartbeats += 1;
        },
        heartbeatIntervalMs: 1,
        cancellationSignal: cancellation.signal,
        runCommand: ({ abortSignal }) =>
          new Promise((_, reject) => {
            abortSignal?.addEventListener(
              "abort",
              () =>
                reject(
                  abortSignal.reason instanceof Error
                    ? abortSignal.reason
                    : new Error("activity cancelled")
                ),
              { once: true }
            );
          })
      },
      0,
      verificationCommand(["exec", "long-running-command"], 60_000),
      "Verifier command failed."
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(POSTGRES_VERIFICATION_HEARTBEAT_INTERVAL_MS).toBeLessThan(2 * 60 * 1000);
    expect(heartbeats).toBeGreaterThan(1);

    cancellation.abort(new Error("activity cancelled"));
    await expect(command).rejects.toThrow("activity cancelled");
  });

  it("force-removes the verifier after a restore command failure and redacts errors", async () => {
    const dump = createDump();
    const harness = verifierHarness({
      onCommand: (command) => {
        if (command.args[0] === "exec" && command.args.includes("pg_restore")) {
          return Promise.reject(new Error("password=super-secret-value"));
        }
        if (command.args[0] === "exec" && command.args.includes("psql")) {
          return Promise.resolve({
            stdout: '{"schemas":2,"tables":3,"indexes":4,"functions":5}'
          });
        }
        return Promise.resolve({ stdout: "" });
      }
    });

    const result = await harness.verifier.verify(inputFor(dump));

    expect(result.success).toBe(false);
    expect(result.checks.restore.status).toBe("failed");
    expect(harness.commands.at(-1)?.args[0]).toBe("rm");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });

  it("force-removes the verifier after the overall timeout", async () => {
    const dump = createDump();
    const harness = verifierHarness({
      onStart: () => harness.advancePastTimeout()
    });

    const result = await harness.verifier.verify(inputFor(dump));

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out after 15 minutes");
    expect(harness.commands.at(-1)?.args[0]).toBe("rm");
    expect(result.cleanup.containerRemoved).toBe(true);
  });

  it("fails verification when force-removal fails without returning cleanup secrets", async () => {
    const dump = createDump();
    const harness = verifierHarness({
      onCommand: (command) => {
        if (command.args[0] === "rm") return Promise.reject(new Error("token=cleanup-secret"));
        if (command.args[0] === "exec" && command.args.includes("psql")) {
          return Promise.resolve({
            stdout: '{"schemas":2,"tables":3,"indexes":4,"functions":5}'
          });
        }
        return Promise.resolve({ stdout: "" });
      }
    });

    const result = await harness.verifier.verify(inputFor(dump));

    expect(result.success).toBe(false);
    expect(result.cleanup.attempted).toBe(true);
    expect(result.cleanup.containerRemoved).toBe(false);
    expect(JSON.stringify(result)).not.toContain("cleanup-secret");
  });
});
