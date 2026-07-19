import { rm } from "node:fs/promises";

export async function removeSensitiveStaging(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
