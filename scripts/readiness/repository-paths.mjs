import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";
import { URL } from "node:url";

function lexicalRepositoryPath(rootDir, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || isAbsolute(relativePath)) {
    return null;
  }
  const root = resolve(rootDir);
  const candidate = resolve(root, relativePath);
  const repositoryRelative = relative(root, candidate);
  if (
    repositoryRelative === "" ||
    repositoryRelative.startsWith("..") ||
    isAbsolute(repositoryRelative)
  ) {
    return null;
  }
  return candidate;
}

async function realPathIsContained(rootDir, candidate) {
  const [root, target] = await Promise.all([realpath(rootDir), realpath(candidate)]);
  const repositoryRelative = relative(root, target);
  return !repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative);
}

function decodeLinkPath(pathname) {
  let decoded = pathname;
  for (let index = 0; index < 8; index += 1) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) return decoded.replaceAll("\\", "/");
    decoded = next;
  }
  throw new Error("link path uses excessive encoding");
}

export async function resolveRepositoryFile(rootDir, relativePath) {
  const candidate = lexicalRepositoryPath(rootDir, relativePath);
  if (!candidate) return null;
  try {
    const metadata = await stat(candidate);
    if (!metadata.isFile() || !(await realPathIsContained(rootDir, candidate))) return null;
    return candidate;
  } catch {
    return null;
  }
}

export async function resolveRepositoryOutput(rootDir, relativePath) {
  const candidate = lexicalRepositoryPath(rootDir, relativePath);
  if (!candidate) return null;

  let current = candidate;
  while (current !== dirname(current)) {
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") return null;
      current = dirname(current);
      continue;
    }

    if (current === candidate) {
      if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    } else {
      try {
        const targetMetadata = await stat(current);
        if (!targetMetadata.isDirectory()) return null;
      } catch {
        return null;
      }
    }
    return (await realPathIsContained(rootDir, current)) ? candidate : null;
  }
  return null;
}

export async function isSafeRepositoryLink(rootDir, sourcePath, linkTarget) {
  if (linkTarget.startsWith("#")) return true;
  if (/^https:\/\//.test(linkTarget)) {
    try {
      const url = new URL(linkTarget);
      const normalizedPath = posix.normalize(decodeLinkPath(url.pathname));
      return (
        url.protocol === "https:" &&
        url.hostname === "github.com" &&
        url.port === "" &&
        url.username === "" &&
        url.password === "" &&
        (normalizedPath === "/DaoFlow-dev/DaoFlow" ||
          normalizedPath.startsWith("/DaoFlow-dev/DaoFlow/"))
      );
    } catch {
      return false;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(linkTarget)) return false;

  let pathOnly;
  try {
    pathOnly = decodeLinkPath(linkTarget.split(/[?#]/, 1)[0]);
  } catch {
    return false;
  }
  const sourceFile = await resolveRepositoryFile(rootDir, sourcePath);
  if (!sourceFile || pathOnly.length === 0) return false;
  const linkedPath = relative(rootDir, resolve(dirname(sourceFile), pathOnly));
  return Boolean(await resolveRepositoryFile(rootDir, linkedPath));
}
