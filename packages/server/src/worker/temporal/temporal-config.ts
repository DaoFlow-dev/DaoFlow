/**
 * temporal-config.ts — Shared Temporal configuration constants.
 *
 * Single source of truth for Temporal address, namespace, and task queue.
 * Consumed by both the Temporal client (API layer) and worker (activity layer).
 */

export const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
export const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "daoflow";
export const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "daoflow-deployments";

/**
 * Check if Temporal dispatching is enabled.
 *
 * Requires both:
 * - DAOFLOW_ENABLE_TEMPORAL=true (opt-in flag)
 * - TEMPORAL_ADDRESS is set (connection target exists)
 */
export function isTemporalEnabled(): boolean {
  return process.env.DAOFLOW_ENABLE_TEMPORAL === "true" && !!process.env.TEMPORAL_ADDRESS;
}
