import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DevelopmentTaskChangedFile {
  path: string;
  status: string;
}

export function parseDevelopmentTaskChangedFiles(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): DevelopmentTaskChangedFile => {
      const [status, ...pathParts] = line.split("\t");
      return {
        status: status ?? "unknown",
        path: pathParts.join(" -> ")
      };
    })
    .filter((file) => file.path);
}

export async function writeDevelopmentTaskReviewArtifacts(input: {
  artifactsPath: string;
  diffStat: string;
  changedFiles: DevelopmentTaskChangedFile[];
}) {
  const diffStatPath = path.join(input.artifactsPath, "diff-stat.txt");
  const changedFilesPath = path.join(input.artifactsPath, "changed-files.json");

  await Promise.all([
    writeFile(diffStatPath, `${input.diffStat}\n`, { mode: 0o600 }),
    writeFile(changedFilesPath, `${JSON.stringify(input.changedFiles, null, 2)}\n`, {
      mode: 0o600
    })
  ]);
  await Promise.all([chmod(diffStatPath, 0o600), chmod(changedFilesPath, 0o600)]);

  return { diffStatPath, changedFilesPath };
}
