function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneComposeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneComposeValue(entry));
  }

  if (isRecord(value)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = cloneComposeValue(entry);
    }
    return cloned;
  }

  return value;
}

function mergeComposeValues(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(override)) {
    return [
      ...base.map((entry) => cloneComposeValue(entry)),
      ...override.map((entry) => cloneComposeValue(entry))
    ];
  }

  if (isRecord(base) && isRecord(override)) {
    const merged: Record<string, unknown> = Object.fromEntries(
      Object.entries(base).map(([key, value]) => [key, cloneComposeValue(value)])
    );

    for (const [key, value] of Object.entries(override)) {
      merged[key] =
        key in merged ? mergeComposeValues(merged[key], value) : cloneComposeValue(value);
    }

    return merged;
  }

  return cloneComposeValue(override);
}

export function mergeComposeDocuments(
  docs: Array<Record<string, unknown>>
): Record<string, unknown> {
  return docs.reduce<Record<string, unknown>>(
    (merged, doc) => mergeComposeValues(merged, doc) as Record<string, unknown>,
    {}
  );
}
