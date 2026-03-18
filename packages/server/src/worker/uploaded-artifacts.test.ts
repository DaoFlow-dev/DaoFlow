import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
      destinationDir
    });

    expect(restored.restoredFiles.sort()).toEqual(["compose.yaml", "context.tar.gz"]);
    expect(readFileSync(join(destinationDir, "compose.yaml"), "utf8")).toContain("services:");
    expect(readFileSync(join(destinationDir, "context.tar.gz"), "utf8")).toBe("archive bytes");
    expect(statSync(join(destinationDir, "compose.yaml")).mode & 0o777).toBe(0o600);
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
