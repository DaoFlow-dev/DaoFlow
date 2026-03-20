import { posix } from "node:path";
import { asRecord, readStringArray } from "./db/services/json-helpers";

const WEBHOOK_AUTO_DEPLOY_CONFIG_KEY = "webhookAutoDeploy";

export interface WebhookAutoDeployConfig {
  watchedPaths: string[];
}

function escapeRegex(input: string): string {
  return input.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function normalizePathLikeValue(input: string): string | null {
  const raw = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw) {
    return null;
  }

  const normalized = posix.normalize(raw).replace(/^(\.\/)+/, "");
  if (!normalized || normalized === ".") {
    return null;
  }

  return normalized;
}

function normalizeWebhookPathPattern(input: string): string | null {
  const normalized = normalizePathLikeValue(input);
  if (!normalized) {
    return null;
  }

  return normalized.endsWith("/") ? `${normalized}**` : normalized;
}

function globToRegExp(pattern: string): RegExp {
  let expression = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const current = pattern[index];
    const next = pattern[index + 1];

    if (current === "*" && next === "*") {
      expression += ".*";
      index += 1;
      continue;
    }

    if (current === "*") {
      expression += "[^/]*";
      continue;
    }

    if (current === "?") {
      expression += "[^/]";
      continue;
    }

    expression += escapeRegex(current);
  }

  expression += "$";
  return new RegExp(expression);
}

export function normalizeWebhookWatchedPaths(
  value: Iterable<string | null | undefined> | null | undefined
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of value ?? []) {
    if (typeof entry !== "string") {
      continue;
    }

    const pattern = normalizeWebhookPathPattern(entry);
    if (!pattern || seen.has(pattern)) {
      continue;
    }

    seen.add(pattern);
    normalized.push(pattern);
  }

  return normalized;
}

export function readWebhookAutoDeployConfig(config: unknown): WebhookAutoDeployConfig {
  const configRecord = asRecord(config);
  const webhookRecord = asRecord(configRecord[WEBHOOK_AUTO_DEPLOY_CONFIG_KEY]);

  return {
    watchedPaths: normalizeWebhookWatchedPaths(readStringArray(webhookRecord, "watchedPaths"))
  };
}

export function writeWebhookAutoDeployConfigToConfig(input: {
  config: Record<string, unknown>;
  watchedPaths?: string[] | null;
}): Record<string, unknown> {
  const nextConfig = { ...input.config };

  if (input.watchedPaths === undefined) {
    return nextConfig;
  }

  const watchedPaths = normalizeWebhookWatchedPaths(input.watchedPaths);
  if (watchedPaths.length === 0) {
    delete nextConfig[WEBHOOK_AUTO_DEPLOY_CONFIG_KEY];
    return nextConfig;
  }

  nextConfig[WEBHOOK_AUTO_DEPLOY_CONFIG_KEY] = {
    watchedPaths
  };
  return nextConfig;
}

export function normalizeWebhookChangedPaths(
  value: Iterable<string | null | undefined> | null | undefined
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of value ?? []) {
    if (typeof entry !== "string") {
      continue;
    }

    const path = normalizePathLikeValue(entry);
    if (!path || seen.has(path)) {
      continue;
    }

    seen.add(path);
    normalized.push(path);
  }

  return normalized;
}

export function matchWebhookWatchedPaths(input: {
  watchedPaths: string[];
  changedPaths: string[];
}): {
  matched: boolean;
  matchedPaths: string[];
  watchedPaths: string[];
} {
  const watchedPaths = normalizeWebhookWatchedPaths(input.watchedPaths);
  if (watchedPaths.length === 0) {
    return {
      matched: true,
      matchedPaths: normalizeWebhookChangedPaths(input.changedPaths),
      watchedPaths
    };
  }

  const changedPaths = normalizeWebhookChangedPaths(input.changedPaths);
  const expressions = watchedPaths.map(globToRegExp);
  const matchedPaths = changedPaths.filter((path) =>
    expressions.some((expression) => expression.test(path))
  );

  return {
    matched: matchedPaths.length > 0,
    matchedPaths,
    watchedPaths
  };
}
