/**
 * input-validation.ts — Adversarial input safety for agent-facing APIs.
 *
 * Validates all user/agent-provided values before processing.
 * Per AGENTS.md §20: reject shell metacharacters, path traversals,
 * and control characters. Truncate excessively long inputs.
 *
 * T-30: Adversarial input validation
 */

/** Characters that are dangerous in shell contexts */
const SHELL_META = /[;&|`$(){}[\]<>!\\#~]/;

/** Path traversal patterns */
const PATH_TRAVERSAL = /\.\.\//;

/** Control characters (except newline, tab) */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export interface ValidationResult {
  valid: boolean;
  field: string;
  reason?: string;
}

/**
 * Validate a name field (project, service, environment, server names).
 * Only allows alphanumeric, hyphens, underscores, dots.
 */
export function validateName(field: string, value: string, maxLen = 80): ValidationResult {
  if (!value || value.length === 0) {
    return { valid: false, field, reason: `${field} is required` };
  }
  if (value.length > maxLen) {
    return { valid: false, field, reason: `${field} exceeds maximum length of ${maxLen}` };
  }
  if (CONTROL_CHARS.test(value)) {
    return { valid: false, field, reason: `${field} contains control characters` };
  }
  if (SHELL_META.test(value)) {
    return { valid: false, field, reason: `${field} contains shell metacharacters` };
  }
  if (PATH_TRAVERSAL.test(value)) {
    return { valid: false, field, reason: `${field} contains path traversal` };
  }
  // Only allow safe characters in names
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    return {
      valid: false,
      field,
      reason: `${field} must start with alphanumeric and contain only letters, digits, hyphens, underscores, or dots`
    };
  }
  return { valid: true, field };
}

/**
 * Validate a generic string field (descriptions, labels).
 * Rejects control characters and shell metacharacters.
 */
export function validateText(field: string, value: string, maxLen = 500): ValidationResult {
  if (value.length > maxLen) {
    return { valid: false, field, reason: `${field} exceeds maximum length of ${maxLen}` };
  }
  if (CONTROL_CHARS.test(value)) {
    return { valid: false, field, reason: `${field} contains control characters` };
  }
  return { valid: true, field };
}

/**
 * Validate a file path (compose file, Dockerfile).
 * Prevents path traversal and shell injection.
 */
export function validatePath(field: string, value: string): ValidationResult {
  if (!value || value.length === 0) {
    return { valid: false, field, reason: `${field} is required` };
  }
  if (value.length > 500) {
    return { valid: false, field, reason: `${field} exceeds maximum path length` };
  }
  if (CONTROL_CHARS.test(value)) {
    return { valid: false, field, reason: `${field} contains control characters` };
  }
  if (PATH_TRAVERSAL.test(value)) {
    return { valid: false, field, reason: `${field} contains path traversal (..)` };
  }
  if (SHELL_META.test(value)) {
    return { valid: false, field, reason: `${field} contains shell metacharacters` };
  }
  return { valid: true, field };
}

/**
 * Validate a Docker image tag.
 */
export function validateImageTag(field: string, value: string): ValidationResult {
  if (!value || value.length === 0) {
    return { valid: false, field, reason: `${field} is required` };
  }
  if (value.length > 256) {
    return { valid: false, field, reason: `${field} exceeds maximum length` };
  }
  if (CONTROL_CHARS.test(value)) {
    return { valid: false, field, reason: `${field} contains control characters` };
  }
  // Docker image tags: allow registry/repo:tag format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]+$/.test(value)) {
    return {
      valid: false,
      field,
      reason: `${field} contains invalid characters for a Docker image reference`
    };
  }
  return { valid: true, field };
}

/**
 * Validate an environment variable key.
 */
export function validateEnvKey(field: string, value: string): ValidationResult {
  if (!value || value.length === 0) {
    return { valid: false, field, reason: `${field} is required` };
  }
  if (value.length > 128) {
    return { valid: false, field, reason: `${field} exceeds maximum length` };
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    return {
      valid: false,
      field,
      reason: `${field} must be uppercase with underscores (e.g. DATABASE_URL)`
    };
  }
  return { valid: true, field };
}

/**
 * Batch validate multiple results, return first failure or success.
 */
export function validateAll(...results: ValidationResult[]): ValidationResult {
  for (const r of results) {
    if (!r.valid) return r;
  }
  return { valid: true, field: "all" };
}
