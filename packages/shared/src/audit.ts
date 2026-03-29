const AUDIT_SINCE_UNIT_MS = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000
} as const;

type AuditSinceUnit = keyof typeof AUDIT_SINCE_UNIT_MS;

export const auditSinceWindowPattern = /^([1-9]\d*)([mhdw])$/;
export const auditSinceWindowError = "Since must be a positive duration like 15m, 1h, 7d, or 2w.";

function parseAuditSinceParts(value: string): {
  normalized: string;
  amount: number;
  unit: AuditSinceUnit;
} {
  const normalized = value.trim().toLowerCase();
  const match = auditSinceWindowPattern.exec(normalized);
  if (!match) {
    throw new Error(auditSinceWindowError);
  }

  const [, rawAmount, rawUnit] = match;
  return {
    normalized,
    amount: Number.parseInt(rawAmount, 10),
    unit: rawUnit as AuditSinceUnit
  };
}

export function normalizeAuditSinceWindow(value: string): string {
  return parseAuditSinceParts(value).normalized;
}

export function parseAuditSinceWindow(value: string, now = Date.now()): Date {
  const { amount, unit } = parseAuditSinceParts(value);
  return new Date(now - amount * AUDIT_SINCE_UNIT_MS[unit]);
}
