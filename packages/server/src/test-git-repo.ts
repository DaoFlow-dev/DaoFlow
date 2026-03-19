import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface LocalGitRepositoryFixture {
  rootDir: string;
  cleanup: () => void;
}

export function createLocalGitRepository(input: {
  branch?: string;
  files: Record<string, string>;
}): LocalGitRepositoryFixture {
  const rootDir = mkdtempSync(join(tmpdir(), "daoflow-git-fixture-"));
  const branch = input.branch ?? "main";

  execFileSync("git", ["init"], { cwd: rootDir });
  execFileSync("git", ["config", "user.email", "daoflow-tests@example.com"], { cwd: rootDir });
  execFileSync("git", ["config", "user.name", "DaoFlow Tests"], { cwd: rootDir });
  execFileSync("git", ["checkout", "-b", branch], { cwd: rootDir });

  for (const [relativePath, content] of Object.entries(input.files)) {
    const filePath = join(rootDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  execFileSync("git", ["add", "."], { cwd: rootDir });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: rootDir });

  return {
    rootDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true })
  };
}
