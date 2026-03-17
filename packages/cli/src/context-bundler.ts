/**
 * context-bundler.ts — Create a tar.gz build context respecting .dockerignore.
 *
 * Algorithm (Fly.io model):
 *  1. Load .dockerignore from context root
 *  2. Optionally load .daoflowignore for DaoFlow-specific overrides
 *  3. Walk directory tree, skip ignored files
 *  4. Create tar.gz archive in temp dir
 *  5. Return archive path + stats
 *
 * This is the same approach Docker CLI uses internally when sending
 * build context to the daemon — we just ship it to the DaoFlow server instead.
 */

import { readdirSync, readFileSync, statSync, existsSync, createWriteStream } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import dockerignore from "@balena/dockerignore";

export interface BundleResult {
  tarPath: string;
  fileCount: number;
  sizeBytes: number;
  /** Files that matched .daoflowignore include overrides (e.g., .env) */
  includedOverrides: string[];
}

export interface BundleOptions {
  contextPath: string;
  /** Extra patterns to ignore (from daoflow.config.* ignore field) */
  extraIgnore?: string[];
  /** Force-include patterns (override ignores, e.g. ".env") */
  extraInclude?: string[];
  /** Max context size in bytes (default: 500MB) */
  maxSizeBytes?: number;
}

const DEFAULT_MAX_SIZE = 500 * 1024 * 1024; // 500MB

/**
 * Create a tar.gz bundle of the build context, respecting .dockerignore.
 */
export async function createContextBundle(opts: BundleOptions): Promise<BundleResult> {
  const contextPath = resolve(opts.contextPath);
  const maxSize = opts.maxSizeBytes ?? DEFAULT_MAX_SIZE;

  // ── Load ignore rules ────────────────────────────────────────
  const ig = dockerignore();

  // 1. .dockerignore (standard Docker behavior)
  const dockerignorePath = join(contextPath, ".dockerignore");
  if (existsSync(dockerignorePath)) {
    const content = readFileSync(dockerignorePath, "utf-8");
    ig.add(content.split("\n"));
  }

  // 2. Extra ignore patterns from config
  if (opts.extraIgnore?.length) {
    ig.add(opts.extraIgnore);
  }

  // 3. .daoflowignore for DaoFlow-specific overrides
  const daoflowIgnorePath = join(contextPath, ".daoflowignore");
  let daoflowIncludes: string[] = [];
  if (existsSync(daoflowIgnorePath)) {
    const content = readFileSync(daoflowIgnorePath, "utf-8");
    const lines = content.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    // Lines starting with ! are force-includes (override .dockerignore)
    daoflowIncludes = lines.filter(l => l.startsWith("!")).map(l => l.slice(1));
    // Non-! lines are extra ignores
    const extraIgnores = lines.filter(l => !l.startsWith("!"));
    if (extraIgnores.length) ig.add(extraIgnores);
  }

  // 4. Force-include patterns from config
  if (opts.extraInclude?.length) {
    daoflowIncludes.push(...opts.extraInclude);
  }

  // ── Walk the directory tree ──────────────────────────────────
  const files: string[] = [];
  const includedOverrides: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(contextPath, fullPath);

      // Always skip .git directory
      if (entry.name === ".git") continue;

      if (entry.isDirectory()) {
        // Check if directory is ignored
        // dockerignore expects paths with trailing slash for directories
        if (ig.ignores(relPath + "/")) continue;
        walk(fullPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const ignored = ig.ignores(relPath);
        const forceIncluded = daoflowIncludes.some(pattern => {
          // Simple glob matching: support exact match and * wildcard
          if (pattern === relPath) return true;
          if (pattern.startsWith("*.")) {
            return relPath.endsWith(pattern.slice(1));
          }
          // Match basename
          return entry.name === pattern;
        });

        if (forceIncluded) {
          files.push(relPath);
          includedOverrides.push(relPath);
        } else if (!ignored) {
          files.push(relPath);
        }
      }
    }
  }

  walk(contextPath);

  if (files.length === 0) {
    throw new Error("No files found in context after applying .dockerignore rules");
  }

  // ── Create tar.gz ────────────────────────────────────────────
  const tarPath = join(tmpdir(), `daoflow-context-${Date.now()}.tar.gz`);

  // Write file list to temp file for tar --files-from
  const fileListPath = join(tmpdir(), `daoflow-filelist-${Date.now()}.txt`);
  const { writeFileSync: writeSync } = await import("node:fs");
  writeSync(fileListPath, files.join("\n") + "\n");

  try {
    execSync(`tar -czf ${tarPath} -C ${contextPath} --files-from=${fileListPath}`, {
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024, // 10MB for stderr
    });
  } catch (err) {
    throw new Error(`Failed to create context archive: ${err instanceof Error ? err.message : err}`);
  } finally {
    try { execSync(`rm -f ${fileListPath}`); } catch { /* best-effort */ }
  }

  const sizeBytes = statSync(tarPath).size;

  if (sizeBytes > maxSize) {
    try { execSync(`rm -f ${tarPath}`); } catch { /* best-effort */ }
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
    const maxMB = (maxSize / 1024 / 1024).toFixed(0);
    throw new Error(
      `Context too large: ${sizeMB}MB exceeds ${maxMB}MB limit. ` +
      `Add entries to .dockerignore to reduce context size.`
    );
  }

  return {
    tarPath,
    fileCount: files.length,
    sizeBytes,
    includedOverrides,
  };
}

/**
 * Parse a compose file and detect services with local build contexts.
 * Returns service names that use `build.context: .` or similar local paths.
 */
export function detectLocalBuildContexts(
  composeContent: string
): { serviceName: string; context: string; dockerfile?: string }[] {
  const { parse } = require("yaml");
  const doc = parse(composeContent);
  const results: { serviceName: string; context: string; dockerfile?: string }[] = [];

  if (!doc?.services) return results;

  for (const [name, svc] of Object.entries(doc.services)) {
    const service = svc as Record<string, unknown>;
    if (typeof service.build === "string") {
      // build: .
      results.push({ serviceName: name, context: service.build });
    } else if (service.build && typeof service.build === "object") {
      const build = service.build as Record<string, unknown>;
      if (typeof build.context === "string") {
        results.push({
          serviceName: name,
          context: build.context,
          dockerfile: typeof build.dockerfile === "string" ? build.dockerfile : undefined,
        });
      }
    }
  }

  return results;
}
