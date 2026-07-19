const SENSITIVE_KEY =
  /(access|auth|credential|database|endpoint|host|key|marker|nonce|password|private|redis|secret|user)/i;

export function redactText(value: string, sensitiveValues: readonly string[]) {
  return sensitiveValues.reduce((current, sensitive) => {
    if (!sensitive) return current;
    return current.split(sensitive).join("[redacted]");
  }, value);
}

export function redactArtifactValue(value: unknown, sensitiveValues: readonly string[]): unknown {
  if (typeof value === "string") return redactText(value, sensitiveValues);
  if (Array.isArray(value))
    return value.map((entry) => redactArtifactValue(entry, sensitiveValues));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : redactArtifactValue(entry, sensitiveValues)
    ])
  );
}
