type CronFieldSpec = {
  min: number;
  max: number;
};

const FIELD_SPECS: CronFieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 }
];

function expandPart(part: string, spec: CronFieldSpec): number[] {
  const [rangeRaw, stepRaw] = part.split("/");
  const step = stepRaw ? Number.parseInt(stepRaw, 10) : 1;
  if (!Number.isInteger(step) || step < 1) return [];

  let start: number;
  let end: number;
  const range = rangeRaw ?? "*";
  if (range === "*") {
    start = spec.min;
    end = spec.max;
  } else if (range.includes("-")) {
    const [startRaw, endRaw] = range.split("-");
    start = Number.parseInt(startRaw ?? "", 10);
    end = Number.parseInt(endRaw ?? "", 10);
  } else {
    start = Number.parseInt(range, 10);
    end = start;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < spec.min ||
    end > spec.max ||
    start > end
  ) {
    return [];
  }

  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value === 7 && spec.max === 7 ? 0 : value);
  }
  return values;
}

function parseField(field: string, spec: CronFieldSpec): Set<number> | null {
  if (!field || field.length > 40) return null;
  const values = field.split(",").flatMap((part) => expandPart(part.trim(), spec));
  if (values.length === 0) return null;
  return new Set(values);
}

function matches(value: number, allowed: Set<number>) {
  return allowed.has(value);
}

function datePartsInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number.parseInt(values.year ?? "", 10);
  const month = Number.parseInt(values.month ?? "", 10);
  const day = Number.parseInt(values.day ?? "", 10);

  return {
    minute: Number.parseInt(values.minute ?? "", 10),
    hour: Number.parseInt(values.hour ?? "", 10),
    day,
    month,
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  };
}

function matchesCron(date: Date, fields: Set<number>[], timezone: string) {
  const parts = datePartsInTimezone(date, timezone);
  return (
    matches(parts.minute, fields[0]) &&
    matches(parts.hour, fields[1]) &&
    matches(parts.day, fields[2]) &&
    matches(parts.month, fields[3]) &&
    matches(parts.dayOfWeek, fields[4])
  );
}

export function validateCronExpression(expression: string): string | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return "Cron expression must use five fields: minute hour day-of-month month day-of-week.";
  }

  for (let index = 0; index < parts.length; index += 1) {
    if (!parseField(parts[index], FIELD_SPECS[index])) {
      return `Cron field ${index + 1} is invalid.`;
    }
  }

  return null;
}

export function validateTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function computeNextRunAt(expression: string, from = new Date(), timezone = "UTC"): Date {
  const fields = expression
    .trim()
    .split(/\s+/)
    .map((field, index) => parseField(field, FIELD_SPECS[index]));

  if (fields.some((field) => field === null)) {
    throw new Error("Invalid cron expression.");
  }

  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const maxMinutes = 366 * 24 * 60;
  for (let index = 0; index < maxMinutes; index += 1) {
    if (matchesCron(cursor, fields as Set<number>[], timezone)) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error("Cron expression did not produce a run time in the next year.");
}
