import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";

export function developmentTaskWorkspaceRoot(workspace: PreparedDevelopmentTaskCodexWorkspace) {
  const root = path.dirname(workspace.repoPath);
  for (const child of [
    workspace.repoPath,
    workspace.codexHomePath,
    workspace.logsPath,
    workspace.artifactsPath
  ]) {
    const relative = path.relative(root, child);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Sandbox paths must stay inside the run workspace.");
    }
  }
  return root;
}

function runProcess(command: string, args: string[], cwd?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new Error(
          `${command} ${args.join(" ")} failed${signal ? ` with ${signal}` : ""}${detail ? `: ${detail}` : ""}`
        )
      );
    });
  });
}

async function pathExists(filePath: string) {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function copyDirectory(source: string, target: string) {
  await rm(target, { recursive: true, force: true });
  await runProcess("cp", ["-R", source, target]);
}

async function swapDirectory(target: string, staged: string | null) {
  await rm(target, { recursive: true, force: true });
  if (staged) {
    await rename(staged, target);
  }
}

export async function createWorkspaceArchive(input: {
  workspace: PreparedDevelopmentTaskCodexWorkspace;
}) {
  const root = developmentTaskWorkspaceRoot(input.workspace);
  const archiveDir = await mkdtemp(path.join(tmpdir(), "daoflow-sandbox-upload-"));
  try {
    const archivePath = path.join(archiveDir, "workspace.tar");
    await runProcess("tar", ["--exclude", "./logs", "-C", root, "-cf", archivePath, "."]);
    return await readFile(archivePath);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
}

async function writeReadableStreamToFile(stream: ReadableStream, filePath: string) {
  await writeFile(filePath, Buffer.from(await new Response(stream).arrayBuffer()));
}

export async function restoreWorkspaceArchive(input: {
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  stream: ReadableStream;
}) {
  const root = developmentTaskWorkspaceRoot(input.workspace);
  await mkdir(root, { recursive: true });
  const archiveDir = await mkdtemp(path.join(tmpdir(), "daoflow-sandbox-download-"));
  try {
    const archivePath = path.join(archiveDir, "workspace.tar");
    const extractRoot = path.join(archiveDir, "extract");
    await mkdir(extractRoot, { recursive: true });
    await writeReadableStreamToFile(input.stream, archivePath);
    await runProcess("tar", ["--exclude", "./logs", "-C", extractRoot, "-xf", archivePath]);

    const targets = [
      input.workspace.repoPath,
      input.workspace.artifactsPath,
      path.dirname(input.workspace.codexHomePath)
    ];
    const stagedTargets = await Promise.all(
      targets.map(async (target) => {
        const relative = path.relative(root, target);
        const source = path.join(extractRoot, relative);
        if (!(await pathExists(source))) {
          return { target, staged: null };
        }
        const staged = `${target}.incoming-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await copyDirectory(source, staged);
        return { target, staged };
      })
    );

    await Promise.all(stagedTargets.map(({ target, staged }) => swapDirectory(target, staged)));
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
}
