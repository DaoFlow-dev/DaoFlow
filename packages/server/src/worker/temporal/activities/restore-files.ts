import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function findFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const stats = statSync(root);
  if (stats.isFile()) {
    return [root];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return findFiles(path);
    }
    return entry.isFile() ? [path] : [];
  });
}

export function findLargestFile(root: string): string | null {
  const files = findFiles(root);
  if (files.length === 0) {
    return null;
  }
  return files.sort((a, b) => statSync(b).size - statSync(a).size)[0] ?? null;
}

export function byteSizeOfPath(path: string): number {
  if (!existsSync(path)) {
    return 0;
  }
  const stats = statSync(path);
  if (stats.isFile()) {
    return stats.size;
  }
  if (!stats.isDirectory()) {
    return 0;
  }

  return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
    return total + byteSizeOfPath(join(path, entry.name));
  }, 0);
}
