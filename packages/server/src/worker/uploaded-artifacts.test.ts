import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("uploaded artifacts", () => {
  let stagingRoot: string;
  let sourceDir: string;
  let destinationDir: string;
  let originalGitWorkDir: string | undefined;

  beforeEach(() => {
    originalGitWorkDir = process.env.GIT_WORK_DIR;
    stagingRoot = mkdtempSync(join(tmpdir(), "daoflow-uploaded-artifacts-"));
    sourceDir = join(stagingRoot, "source");
    destinationDir = join(stagingRoot, "destination");
    mkdirSync(sourceDir, { recursive: true });
    process.env.GIT_WORK_DIR = stagingRoot;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalGitWorkDir === undefined) {
      delete process.env.GIT_WORK_DIR;
    } else {
      process.env.GIT_WORK_DIR = originalGitWorkDir;
    }
    rmSync(stagingRoot, { recursive: true, force: true });
  });

  it("persists uploaded compose artifacts outside the per-deployment staging directory", async () => {
    const { persistUploadedArtifacts, restoreUploadedArtifacts } =
      await import("./uploaded-artifacts");

    writeFileSync(join(sourceDir, "compose.yaml"), "services:\n  app:\n    image: nginx:alpine\n");
    writeFileSync(join(sourceDir, "context.tar.gz"), "archive bytes");

    const { artifactId } = await persistUploadedArtifacts({
      sourceDir,
      composeFileName: "compose.yaml",
      contextArchiveName: "context.tar.gz"
    });

    rmSync(sourceDir, { recursive: true, force: true });

    const restored = await restoreUploadedArtifacts({
      artifactId,
      destinationDir,
      composeFileName: "compose.yaml",
      contextArchiveName: "context.tar.gz"
    });

    expect(restored.restoredFiles.sort()).toEqual(["compose.yaml", "context.tar.gz"]);
    expect(readFileSync(join(destinationDir, "compose.yaml"), "utf8")).toContain("services:");
    expect(readFileSync(join(destinationDir, "context.tar.gz"), "utf8")).toBe("archive bytes");
    expect(statSync(join(destinationDir, "compose.yaml")).mode & 0o777).toBe(0o600);
  });

  it("restores legacy retained artifacts when the deployment snapshot names the expected files", async () => {
    const { restoreUploadedArtifacts } = await import("./uploaded-artifacts");

    const artifactDir = join(stagingRoot, "uploaded-artifacts", "0123456789abcdef0123456789abcdef");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, "compose.yaml"),
      "services:\n  app:\n    image: nginx:alpine\n"
    );
    writeFileSync(join(artifactDir, "context.tar.gz"), "archive bytes");

    const restored = await restoreUploadedArtifacts({
      artifactId: "0123456789abcdef0123456789abcdef",
      destinationDir,
      composeFileName: "compose.yaml",
      contextArchiveName: "context.tar.gz"
    });

    expect(restored.restoredFiles.sort()).toEqual(["compose.yaml", "context.tar.gz"]);
    expect(readFileSync(join(destinationDir, "context.tar.gz"), "utf8")).toBe("archive bytes");
  });

  it("does not publish a retained artifact until every required file is copied", async () => {
    const { persistUploadedArtifacts } = await import("./uploaded-artifacts");

    writeFileSync(join(sourceDir, "compose.yaml"), "services:\n  app:\n    image: nginx:alpine\n");

    await expect(
      persistUploadedArtifacts({
        sourceDir,
        composeFileName: "compose.yaml",
        contextArchiveName: "missing.tar.gz",
        artifactId: "fedcba9876543210fedcba9876543210"
      })
    ).rejects.toThrow();

    const artifactsRoot = join(stagingRoot, "uploaded-artifacts");
    expect(readdirSync(artifactsRoot)).toEqual([]);
  });

  it("prunes retained artifacts once they age past the replay window", async () => {
    const { persistUploadedArtifacts, pruneUploadedArtifacts, UPLOADED_ARTIFACT_RETENTION_MS } =
      await import("./uploaded-artifacts");

    writeFileSync(join(sourceDir, "compose.yaml"), "services:\n  app:\n    image: nginx:alpine\n");

    const { artifactId } = await persistUploadedArtifacts({
      sourceDir,
      composeFileName: "compose.yaml",
      artifactId: "abcdefabcdefabcdefabcdefabcdefab"
    });

    const artifactDir = join(stagingRoot, "uploaded-artifacts", artifactId);
    const expiredAt = new Date(Date.now() - UPLOADED_ARTIFACT_RETENTION_MS - 1_000);
    utimesSync(artifactDir, expiredAt, expiredAt);

    const pruneResult = await pruneUploadedArtifacts();

    expect(pruneResult.prunedArtifacts).toBe(1);
    expect(readdirSync(join(stagingRoot, "uploaded-artifacts"))).toEqual([]);
  });

  it("rejects incomplete retained artifacts with a clear replay error", async () => {
    const { restoreUploadedArtifacts } = await import("./uploaded-artifacts");

    const artifactDir = join(stagingRoot, "uploaded-artifacts", "11111111111111111111111111111111");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, "compose.yaml"),
      "services:\n  app:\n    image: nginx:alpine\n"
    );

    await expect(
      restoreUploadedArtifacts({
        artifactId: "11111111111111111111111111111111",
        destinationDir,
        composeFileName: "compose.yaml",
        contextArchiveName: "context.tar.gz"
      })
    ).rejects.toThrow(
      'Uploaded artifact "11111111111111111111111111111111" is incomplete and cannot be replayed. Re-upload the compose source before retrying.'
    );
  });

  it("rejects invalid replay ids before touching the filesystem", async () => {
    const { restoreUploadedArtifacts } = await import("./uploaded-artifacts");

    await expect(
      restoreUploadedArtifacts({
        artifactId: "../bad",
        destinationDir
      })
    ).rejects.toThrow('Invalid uploaded artifact id "../bad".');
  });
});
