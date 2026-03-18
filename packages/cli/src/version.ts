/**
 * CLI version — inlined at build time by Bun's bundler.
 *
 * Using a static import ensures the version string is embedded
 * directly into the compiled binary. The readFileSync approach
 * fails in compiled binaries because the path can't be resolved
 * at runtime.
 */
import pkg from "../package.json";

/** Semantic version of the CLI (matches package.json at build time). */
export const CLI_VERSION: string = (pkg as { version: string }).version;
