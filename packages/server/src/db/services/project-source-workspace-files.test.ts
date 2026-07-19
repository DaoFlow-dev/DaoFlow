import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProjectSourceWorkspaceFile } from "./project-source-workspace-files";

describe("project source workspace files", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("accepts regular files and rejects lexical or symlink escapes", () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-source-workspace-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "daoflow-source-outside-"));
    directories.push(workDir, outsideDir);
    const safePath = join(workDir, "compose.yaml");
    const outsidePath = join(outsideDir, "secret.txt");
    writeFileSync(safePath, "services: {}\n");
    writeFileSync(outsidePath, "not repository content\n");
    symlinkSync(outsidePath, join(workDir, "escaped.yaml"));

    expect(resolveProjectSourceWorkspaceFile(workDir, "compose.yaml")).toEqual({
      status: "ok",
      path: realpathSync(safePath)
    });
    expect(resolveProjectSourceWorkspaceFile(workDir, "../secret.txt")).toEqual({
      status: "unsafe"
    });
    expect(resolveProjectSourceWorkspaceFile(workDir, "escaped.yaml")).toEqual({
      status: "unsafe"
    });
  });
});
