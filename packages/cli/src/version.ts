import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Read the CLI version from package.json at build time.
 *
 * Bun's bundler inlines the file read at compile, so the compiled
 * binary always carries the version it was built with.
 */
let _version = "0.0.0-dev";
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkgPath = resolve(__dirname, "../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
  _version = pkg.version;
} catch {
  // Fallback for unusual runtime environments
}

/** Semantic version of the CLI (matches package.json at build time). */
export const CLI_VERSION: string = _version;
