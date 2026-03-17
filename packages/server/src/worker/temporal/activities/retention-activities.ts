/**
 * Retention activities for Temporal workflows.
 *
 * Implements Grandfather-Father-Son (GFS) backup retention pruning:
 * - Daily: keep last N daily backups
 * - Weekly: keep last N weekly backups (oldest daily per week)
 * - Monthly: keep last N monthly backups (oldest weekly per month)
 *
 * Also provides a hard-cap safety net via maxBackups.
 */

import { desc, eq, and } from "drizzle-orm";
import { db } from "../../../db/connection";
import { backupRuns } from "../../../db/schema/storage";
import { deleteRemote, type DestinationConfig } from "../../rclone-executor";

// ── Types ────────────────────────────────────────────────────

export interface RetentionConfig {
  policyId: string;
  retentionDaily: number;
  retentionWeekly: number;
  retentionMonthly: number;
  maxBackups: number;
  /** If true, only list what would be deleted without acting */
  dryRun?: boolean;
  /** rclone destination config for deleting remote artifacts */
  destination?: DestinationConfig;
}

export interface RetentionResult {
  policyId: string;
  totalRuns: number;
  keptRuns: number;
  deletedRuns: number;
  deletedArtifacts: string[];
  dryRun: boolean;
  errors: string[];
}

// ── GFS Retention Activity ──────────────────────────────────

/**
 * Apply GFS retention policy to backup runs for a given policy.
 *
 * Algorithm:
 * 1. Fetch all succeeded runs for the policy, sorted by createdAt DESC
 * 2. Tag each run as daily/weekly/monthly based on calendar position
 * 3. Keep: most recent N daily, most recent N weekly, most recent N monthly
 * 4. Hard cap: never exceed maxBackups total, delete oldest first
 * 5. Delete everything else (both DB record status→"pruned" and remote artifact)
 */
export async function applyRetentionPolicy(config: RetentionConfig): Promise<RetentionResult> {
  const {
    policyId,
    retentionDaily,
    retentionWeekly,
    retentionMonthly,
    maxBackups,
    dryRun = false,
    destination
  } = config;

  const result: RetentionResult = {
    policyId,
    totalRuns: 0,
    keptRuns: 0,
    deletedRuns: 0,
    deletedArtifacts: [],
    dryRun,
    errors: []
  };

  // 1. Fetch all succeeded runs for this policy
  const runs = await db
    .select()
    .from(backupRuns)
    .where(and(eq(backupRuns.policyId, policyId), eq(backupRuns.status, "succeeded")))
    .orderBy(desc(backupRuns.createdAt));

  result.totalRuns = runs.length;

  if (runs.length === 0) {
    return result;
  }

  // 2. Classify runs into GFS tiers
  const keptIds = new Set<string>();

  // Daily: keep the N most recent
  const dailyKeep = runs.slice(0, retentionDaily);
  for (const run of dailyKeep) keptIds.add(run.id);

  // Weekly: keep the most recent run from each of the last N weeks
  const weeklyRuns = selectPerPeriod(runs, "week", retentionWeekly);
  for (const run of weeklyRuns) keptIds.add(run.id);

  // Monthly: keep the most recent run from each of the last N months
  const monthlyRuns = selectPerPeriod(runs, "month", retentionMonthly);
  for (const run of monthlyRuns) keptIds.add(run.id);

  // 3. Apply hard cap — if we still have more than maxBackups, trim oldest
  const keptRunsList = runs.filter((r) => keptIds.has(r.id));
  if (keptRunsList.length > maxBackups) {
    // Sort by createdAt desc, keep only maxBackups most recent
    const sorted = keptRunsList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const toRemove = sorted.slice(maxBackups);
    for (const run of toRemove) keptIds.delete(run.id);
  }

  // 4. Delete runs that aren't kept
  const toDelete = runs.filter((r) => !keptIds.has(r.id));
  result.keptRuns = runs.length - toDelete.length;
  result.deletedRuns = toDelete.length;

  for (const run of toDelete) {
    if (run.artifactPath) {
      result.deletedArtifacts.push(run.artifactPath);
    }

    if (!dryRun) {
      try {
        // Delete remote artifact if destination is configured
        if (run.artifactPath && destination) {
          deleteRemote(destination, run.artifactPath);
        }

        // Mark the run as "pruned" instead of hard-deleting for audit trail
        await db.update(backupRuns).set({ status: "pruned" }).where(eq(backupRuns.id, run.id));
      } catch (err) {
        result.errors.push(
          `Failed to prune run ${run.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────

type BackupRunRow = typeof backupRuns.$inferSelect;

/**
 * Select the most recent run from each calendar period (week or month).
 * Returns up to `limit` runs.
 */
function selectPerPeriod(
  runs: BackupRunRow[],
  period: "week" | "month",
  limit: number
): BackupRunRow[] {
  const seen = new Map<string, BackupRunRow>();

  for (const run of runs) {
    const key = periodKey(run.createdAt, period);
    // Keep the most recent (first in desc order) per period
    if (!seen.has(key)) {
      seen.set(key, run);
      if (seen.size >= limit) break;
    }
  }

  return Array.from(seen.values());
}

/**
 * Generate a unique key for a calendar period.
 * Week: "2024-W03" (ISO week)
 * Month: "2024-01"
 */
function periodKey(date: Date, period: "week" | "month"): string {
  const year = date.getFullYear();

  if (period === "month") {
    return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  // ISO week calculation
  const d = new Date(Date.UTC(year, date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
