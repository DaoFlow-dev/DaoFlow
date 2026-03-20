import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createContextBundle } from "./context-bundler";

const tempPaths: string[] = [];

afterEach(() => {
  while (tempPaths.length > 0) {
    const path = tempPaths.pop();
    if (!path) {
      continue;
    }

    rmSync(path, { recursive: true, force: true });
  }
});

describe("createContextBundle", () => {
  test("creates archives for context roots with spaces while preserving ignore overrides", () => {
    const contextDir = mkdtempSync(join(tmpdir(), "daoflow bundle space "));
    tempPaths.push(contextDir);

    writeFileSync(join(contextDir, ".dockerignore"), "ignored.txt\n.env\n", "utf8");
    writeFileSync(join(contextDir, ".daoflowignore"), "!.env\n", "utf8");
    writeFileSync(join(contextDir, "app.txt"), "app\n", "utf8");
    writeFileSync(join(contextDir, ".env"), "HELLO=world\n", "utf8");
    writeFileSync(join(contextDir, "ignored.txt"), "ignore\n", "utf8");

    const bundle = createContextBundle({ contextPath: contextDir });
    tempPaths.push(bundle.tarPath);

    expect(bundle.includedOverrides).toEqual([".env"]);

    const listResult = spawnSync("tar", ["-tzf", bundle.tarPath], { encoding: "utf8" });
    expect(listResult.status).toBe(0);

    const entries = listResult.stdout
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    expect(entries).toContain(".env");
    expect(entries).toContain("app.txt");
    expect(entries).not.toContain("ignored.txt");

    unlinkSync(bundle.tarPath);
    tempPaths.pop();
  });
});
