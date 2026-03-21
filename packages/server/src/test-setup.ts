import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureTestDatabaseReady } from "./test-db";

const coverageTmpDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../coverage/.tmp"
);

await mkdir(coverageTmpDir, { recursive: true });
await ensureTestDatabaseReady();
