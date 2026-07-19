import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { verifyPostgresRestore } from "../packages/server/src/worker/temporal/activities/postgres-restore-verification";

const sourceImage = "postgres:15-alpine";

test("PostgreSQL verification restores in isolation and leaves the live sentinel unchanged", async () => {
  test.setTimeout(180_000);
  const token = randomUUID().replace(/-/g, "").slice(0, 16);
  const liveContainer = `daoflow-pg-live-${token}`;
  const workspace = mkdtempSync(join(tmpdir(), "daoflow-pg-verification-e2e-"));
  const dumpPath = join(workspace, "database.dump");
  const verifierContainersBefore = listVerifierContainers();

  try {
    docker([
      "run",
      "--detach",
      "--name",
      liveContainer,
      "--network",
      "none",
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=256m,mode=0700",
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--env",
      "POSTGRES_DB=app",
      sourceImage
    ]);
    await waitForPostgres(liveContainer);
    docker([
      "exec",
      liveContainer,
      "psql",
      "--username",
      "postgres",
      "--dbname",
      "app",
      "--set=ON_ERROR_STOP=1",
      "--command",
      "CREATE TABLE verification_sentinel(value text NOT NULL); INSERT INTO verification_sentinel VALUES ('live-unchanged');"
    ]);

    const dump = execFileSync("docker", [
      "exec",
      liveContainer,
      "pg_dump",
      "--username",
      "postgres",
      "--format=custom",
      "app"
    ]);
    writeFileSync(dumpPath, dump, { mode: 0o600 });
    const checksum = createHash("sha256").update(dump).digest("hex");
    const sourceVersion = docker(["exec", liveContainer, "pg_dump", "--version"]).match(
      /PostgreSQL\)\s+([0-9]+(?:\.[0-9]+)*)/
    )?.[1];
    const digest = docker([
      "image",
      "inspect",
      "--format",
      "{{index .RepoDigests 0}}",
      sourceImage
    ]).split("@")[1];
    expect(sourceVersion).toBeTruthy();
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const result = await verifyPostgresRestore({
      restoreId: `e2e-${token}`,
      localDumpPath: dumpPath,
      expectedSha256: checksum,
      sourcePostgresVersion: sourceVersion as string,
      verifierImage: `${sourceImage}@${digest}`
    });

    expect(result.success, result.error).toBe(true);
    expect(result.checksum).toBe(checksum);
    expect(result.sourcePostgresVersion).toBe(sourceVersion);
    expect(result.verifierPostgresVersion).toContain("15");
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.checks.archive.status).toBe("passed");
    expect(result.checks.restore.status).toBe("passed");
    expect(result.checks.catalog.status).toBe("passed");
    expect(result.objectCounts.tables).toBeGreaterThanOrEqual(1);
    expect(result.cleanup.containerRemoved).toBe(true);

    const sentinel = docker([
      "exec",
      liveContainer,
      "psql",
      "--username",
      "postgres",
      "--dbname",
      "app",
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT value FROM verification_sentinel;"
    ]);
    expect(sentinel).toBe("live-unchanged");
    expect(listVerifierContainers()).toEqual(verifierContainersBefore);
  } finally {
    try {
      docker(["rm", "--force", liveContainer]);
    } catch {
      // The fixture may have failed before Docker created it.
    }
    rmSync(workspace, { recursive: true, force: true });
  }
});

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf-8", timeout: 60_000 }).trim();
}

function listVerifierContainers(): string[] {
  const output = docker([
    "ps",
    "--all",
    "--filter",
    "label=com.daoflow.restore-verification=true",
    "--format",
    "{{.Names}}"
  ]);
  return output ? output.split("\n").sort() : [];
}

async function waitForPostgres(containerName: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = docker([
        "exec",
        containerName,
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "app",
        "--tuples-only",
        "--no-align",
        "--command",
        "SELECT 1;"
      ]);
      if (result === "1") return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Live PostgreSQL fixture did not become ready.");
}
