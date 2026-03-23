/**
 * Shared time helpers for seed data.
 * All dates are anchored to the moment the seed runs so "Recent Activity"
 * feels fresh on first launch instead of showing stale absolute dates.
 */

export const FOUNDATION_REFERENCE_TIME = new Date();

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
