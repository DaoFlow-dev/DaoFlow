import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type ProjectSourceWorkspaceFile =
  { status: "ok"; path: string } | { status: "missing" } | { status: "unsafe" };

function escapesWorkspace(workspaceRoot: string, candidate: string): boolean {
  const relativePath = relative(workspaceRoot, candidate);
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

export function resolveProjectSourceWorkspaceFile(
  workDir: string,
  requestedPath: string
): ProjectSourceWorkspaceFile {
  let workspaceRoot: string;
  try {
    workspaceRoot = realpathSync(workDir);
  } catch {
    return { status: "missing" };
  }

  const candidate = resolve(workspaceRoot, requestedPath);
  if (escapesWorkspace(workspaceRoot, candidate)) {
    return { status: "unsafe" };
  }

  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(candidate);
  } catch {
    return { status: "missing" };
  }
  if (escapesWorkspace(workspaceRoot, resolvedPath)) {
    return { status: "unsafe" };
  }

  try {
    return statSync(resolvedPath).isFile()
      ? { status: "ok", path: resolvedPath }
      : { status: "missing" };
  } catch {
    return { status: "missing" };
  }
}
