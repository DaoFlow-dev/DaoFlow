import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ComposeFileInput {
  path: string;
  contents: string;
}

export function readComposeFileSet(input: {
  composePath: string;
  composeOverrides?: string[];
}): ComposeFileInput[] {
  const orderedPaths = [input.composePath, ...(input.composeOverrides ?? [])];
  const composeFiles: ComposeFileInput[] = [];
  const seen = new Set<string>();

  for (const composePath of orderedPaths) {
    const trimmedPath = composePath.trim();
    if (!trimmedPath) {
      continue;
    }

    const resolvedPath = resolve(trimmedPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Compose file not found: ${composePath}`);
    }

    if (seen.has(resolvedPath)) {
      continue;
    }
    seen.add(resolvedPath);

    composeFiles.push({
      path: trimmedPath,
      contents: readFileSync(resolvedPath, "utf8")
    });
  }

  if (composeFiles.length === 0) {
    throw new Error("At least one compose file is required.");
  }

  return composeFiles;
}
