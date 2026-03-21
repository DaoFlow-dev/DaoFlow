/**
 * Worker module index.
 *
 * Re-exports both the legacy polling worker and the Temporal-based worker.
 * The server entry point decides which to start based on TEMPORAL_ADDRESS.
 */
export { startWorker, stopWorker } from "./worker";
export { startTemporalWorker, stopTemporalWorker } from "./temporal/worker";
export {
  startDeploymentWorkflow,
  getDeploymentWorkflowStatus,
  buildBackupCronWorkflowId,
  buildOneOffBackupWorkflowId,
  startBackupCronWorkflow,
  cancelBackupCronWorkflow,
  startOneOffBackupWorkflow,
  getBackupCronStatus,
  closeTemporalClient
} from "./temporal/client";
export type { LogLine, OnLog } from "./docker-executor";
