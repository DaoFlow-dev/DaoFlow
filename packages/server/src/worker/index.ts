/**
 * Worker module index.
 *
 * Re-exports both the legacy polling worker and the Temporal-based worker.
 * The server entry point decides which to start based on TEMPORAL_ADDRESS.
 */
export { startWorker, stopWorker } from "./worker";
export {
  pollDevelopmentTaskQueue,
  startDevelopmentTaskWorker,
  stopDevelopmentTaskWorker
} from "./development-task-worker";
export {
  startDevelopmentTaskWatchdogMonitor,
  stopDevelopmentTaskWatchdogMonitor
} from "./development-task-watchdog-monitor";
export {
  startDeploymentWatchdogMonitor,
  stopDeploymentWatchdogMonitor
} from "./deployment-watchdog-monitor";
export {
  startOperationalMaintenanceMonitor,
  stopOperationalMaintenanceMonitor
} from "./operational-maintenance-monitor";
export {
  startServiceScheduleMonitor,
  stopServiceScheduleMonitor
} from "./service-schedule-monitor";
export {
  completeServiceScheduleRun,
  executeServiceScheduleRun,
  pollServiceScheduleRuns,
  resetServiceScheduleCommandRunnerForTests,
  setServiceScheduleCommandRunnerForTests
} from "./service-schedule-runner";
export { startTemporalWorker, stopTemporalWorker } from "./temporal/worker";
export {
  startDeploymentWorkflow,
  getDeploymentWorkflowStatus,
  buildBackupCronWorkflowId,
  buildOneOffBackupWorkflowId,
  buildRestoreWorkflowId,
  startBackupCronWorkflow,
  cancelBackupCronWorkflow,
  startOneOffBackupWorkflow,
  startRestoreWorkflow,
  getBackupCronStatus,
  closeTemporalClient
} from "./temporal/client";
export type { LogLine, OnLog } from "./docker-executor";
