import { afterEach, describe, expect, it, vi } from "vitest";
import { processRunner } from "../../process-runner";
import { databaseDumpTestHooks } from "./database-dump-activities";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("database dump metadata", () => {
  it("records the custom archive format, source version, and immutable image ID", () => {
    const imageId = `sha256:${"a".repeat(64)}`;
    const repositoryDigest = `sha256:${"b".repeat(64)}`;
    vi.spyOn(processRunner, "execFileSync")
      .mockReturnValueOnce("pg_dump (PostgreSQL) 17.4\n")
      .mockReturnValueOnce(`postgres:17-alpine|${imageId}\n`)
      .mockReturnValueOnce(`postgres@${repositoryDigest}\n`);

    const metadata = databaseDumpTestHooks.inspectDatabaseSource({
      volumeId: "vol_test",
      containerName: "postgres",
      engine: "postgres"
    });

    expect(metadata).toEqual({
      artifactFormat: "postgres-custom",
      databaseEngineVersion: "17.4",
      databaseImageReference: `postgres:17-alpine@${repositoryDigest}`
    });
  });

  it("keeps the backup usable but leaves verification unsupported when the image is untrusted", () => {
    vi.spyOn(processRunner, "execFileSync")
      .mockReturnValueOnce("pg_dump (PostgreSQL) 16.8\n")
      .mockReturnValueOnce("vendor/postgres:16|sha256:not-a-real-image-id\n")
      .mockReturnValueOnce("vendor/postgres@sha256:not-a-real-digest\n");

    expect(
      databaseDumpTestHooks.inspectDatabaseSource({
        volumeId: "vol_test",
        containerName: "postgres",
        engine: "postgres"
      })
    ).toEqual({
      artifactFormat: "postgres-custom",
      databaseEngineVersion: "16.8"
    });
  });

  it("still creates a backup when metadata inspection is unavailable", () => {
    vi.spyOn(processRunner, "execFileSync").mockImplementation(() => {
      throw new Error("image metadata unavailable");
    });

    expect(
      databaseDumpTestHooks.inspectDatabaseSource({
        volumeId: "vol_test",
        containerName: "postgres",
        engine: "postgres"
      })
    ).toEqual({ artifactFormat: "postgres-custom" });
  });

  it("uses PostgreSQL custom format for restore-safe dumps", () => {
    const command = databaseDumpTestHooks.buildDockerExecArgs({
      volumeId: "vol_test",
      containerName: "postgres",
      engine: "postgres",
      databaseName: "app",
      user: "app_user",
      password: "secret"
    });

    expect(command.envArgs).toEqual(["-e", "PGPASSWORD=secret"]);
    expect(command.dockerArgs).toContain("--format=custom");
    expect(command.dockerArgs.at(-1)).toBe("app");
  });
});
