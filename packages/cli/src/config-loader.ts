/**
 * config-loader.ts — Multi-format config file loader.
 *
 * Searches for daoflow.config.{jsonc,json,yaml,yml,toml} and returns
 * a typed DaoflowConfig. First match wins.
 *
 * Per AGENTS.md §20: CLI must be self-documenting and composable.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface DaoflowConfig {
  /** JSON Schema URL for IDE autocompletion */
  $schema?: string;
  /** Project ID or name */
  project?: string;
  /** Default target server */
  server?: string;
  /** Default environment (production, staging) */
  environment?: string;
  /** Path to compose file (default: compose.yaml) */
  compose?: string;
  /** Build context path (default: .) */
  context?: string;
  /** Dockerfile path (default: Dockerfile) */
  dockerfile?: string;
  /** Extra ignore patterns (added to .dockerignore) */
  ignore?: string[];
  /** Force-include patterns (override ignores, e.g. ".env") */
  include?: string[];
  /** Max upload size (e.g. "500mb") */
  maxContextSize?: string;
  /** Build-time env vars */
  env?: Record<string, string>;
}

/** Search order: first match wins */
const CONFIG_FILES = [
  "daoflow.config.jsonc",
  "daoflow.config.json",
  "daoflow.config.yaml",
  "daoflow.config.yml",
  "daoflow.config.toml",
] as const;

export interface ConfigLoadResult {
  config: DaoflowConfig;
  /** Which file was loaded */
  filePath: string;
  /** File format */
  format: "jsonc" | "json" | "yaml" | "toml";
}

/**
 * Load a daoflow config file from the given directory.
 * Returns null if no config file exists.
 */
export function loadDaoflowConfig(dir?: string): ConfigLoadResult | null {
  const searchDir = resolve(dir ?? ".");

  for (const filename of CONFIG_FILES) {
    const filePath = join(searchDir, filename);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const format = detectFormat(filename);
    const config = parseConfig(content, format);

    return { config, filePath, format };
  }

  return null;
}

function detectFormat(filename: string): "jsonc" | "json" | "yaml" | "toml" {
  if (filename.endsWith(".jsonc")) return "jsonc";
  if (filename.endsWith(".json")) return "json";
  if (filename.endsWith(".yaml") || filename.endsWith(".yml")) return "yaml";
  if (filename.endsWith(".toml")) return "toml";
  throw new Error(`Unknown config format: ${filename}`);
}

function parseConfig(content: string, format: "jsonc" | "json" | "yaml" | "toml"): DaoflowConfig {
  switch (format) {
    case "jsonc": {
      const { parse } = require("jsonc-parser");
      const errors: unknown[] = [];
      const result = parse(content, errors, {
        disallowComments: false,
        allowTrailingComma: true,
      });
      if (errors.length > 0) {
        throw new Error(`Invalid JSONC: ${errors.length} parse error(s)`);
      }
      return result as DaoflowConfig;
    }

    case "json":
      return JSON.parse(content) as DaoflowConfig;

    case "yaml": {
      const { parse } = require("yaml");
      return parse(content) as DaoflowConfig;
    }

    case "toml": {
      const { parse } = require("smol-toml");
      return parse(content) as DaoflowConfig;
    }
  }
}

/**
 * Parse a size string like "500mb" or "1gb" to bytes.
 */
export function parseSizeString(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)$/i);
  if (!match) throw new Error(`Invalid size string: ${size}`);

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
  };

  return Math.floor(value * multipliers[unit]);
}
