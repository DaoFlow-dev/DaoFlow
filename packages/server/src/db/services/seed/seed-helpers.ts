/**
 * Shared time helpers for seed data.
 * All dates are anchored to FOUNDATION_REFERENCE_TIME for reproducibility.
 */

export const FOUNDATION_REFERENCE_TIME = new Date("2026-03-12T18:45:00.000Z");

export function daysBefore(days: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() - days * 24 * 60 * 60 * 1000);
}

export function hoursBefore(hours: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() - hours * 60 * 60 * 1000);
}

export function minutesBefore(minutes: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() - minutes * 60 * 1000);
}

export function hoursAfter(hours: number) {
  return new Date(FOUNDATION_REFERENCE_TIME.getTime() + hours * 60 * 60 * 1000);
}
