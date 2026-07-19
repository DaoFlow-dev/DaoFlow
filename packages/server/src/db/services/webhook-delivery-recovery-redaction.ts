const MAX_STORED_WEBHOOK_DETAIL_LENGTH = 1_000;
const SAFE_METADATA_KEYS = new Set([
  "action",
  "branch",
  "changedPaths",
  "commitSha",
  "deploymentCount",
  "eventAction",
  "failedTargetCount",
  "ignoredTargetCount",
  "issueNumber",
  "previewAction",
  "previewKey",
  "projectCount",
  "ref",
  "repoFullName",
  "serviceCount",
  "source",
  "targetCount",
  "trigger"
]);

function toMessage(value: unknown) {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "symbol") {
    return value.description ?? null;
  }

  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

export function sanitizeWebhookDeliveryDetail(value: unknown) {
  const message = toMessage(value);
  if (!message) {
    return null;
  }

  const sanitized = message
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]")
    .replace(
      /\b(?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|webhook[_-]?token|provider[_-]?secret|secret|password|signature|x-[a-z-]*signature(?:-\d+)?|sha256)\b\s*[:=]\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
      (match) => {
        const separator = match.includes(":") ? ":" : "=";
        const label = match.slice(0, match.indexOf(separator)).trim();
        return `${label}${separator}[redacted]`;
      }
    )
    .replace(
      /\b(?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|webhook[_-]?token|provider[_-]?secret|secret|password|signature)\b(?:\s+is)?\s+[A-Za-z0-9\-._~+/]{8,}/gi,
      (match) => `${match.split(/\s+/)[0]} [redacted]`
    )
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g, "[redacted]")
    .replace(/\bglpat-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) {
    return null;
  }

  return sanitized.length > MAX_STORED_WEBHOOK_DETAIL_LENGTH
    ? `${sanitized.slice(0, MAX_STORED_WEBHOOK_DETAIL_LENGTH - 1)}…`
    : sanitized;
}

export function sanitizeWebhookDeliveryMetadata(value: Record<string, unknown> | undefined) {
  const metadata: Record<string, string | number | boolean | null | string[]> = {};

  for (const [key, rawValue] of Object.entries(value ?? {})) {
    if (!SAFE_METADATA_KEYS.has(key)) {
      continue;
    }

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      metadata[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "boolean" || rawValue === null) {
      metadata[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "string") {
      const sanitized = sanitizeWebhookDeliveryDetail(rawValue);
      if (sanitized !== null) {
        metadata[key] = sanitized;
      }
      continue;
    }
    if (Array.isArray(rawValue) && rawValue.every((item) => typeof item === "string")) {
      metadata[key] = rawValue
        .slice(0, 100)
        .map((item) => sanitizeWebhookDeliveryDetail(item))
        .filter((item): item is string => item !== null);
    }
  }

  return metadata;
}
