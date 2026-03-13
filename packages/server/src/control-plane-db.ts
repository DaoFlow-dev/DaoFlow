/**
 * control-plane-db.ts — backward-compatibility re-export shim
 *
 * This file re-exports all service functions so that router.ts imports
 * continue to work unchanged. The actual logic now lives in small,
 * self-contained modules under db/services/*.
 */

// ── Deployments ──────────────────────────────────────────────
export {
  createDeploymentRecord,
  getDeploymentRecord,
  listDeploymentRecords,
  listDeploymentLogs,
  listDeploymentInsights,
  listDeploymentRollbackPlans
} from "./db/services/deployments";

// ── Servers & Infrastructure ─────────────────────────────────
export {
  registerServer,
  listServerReadiness,
  listInfrastructureInventory
} from "./db/services/servers";

// ── Compose ──────────────────────────────────────────────────
export {
  listComposeReleaseCatalog,
  listComposeDriftReport,
  queueComposeRelease
} from "./db/services/compose";

// ── Execution Queue ──────────────────────────────────────────
export {
  listExecutionQueue,
  dispatchExecutionJob,
  completeExecutionJob,
  failExecutionJob
} from "./db/services/execution";

// ── Approvals ────────────────────────────────────────────────
export {
  createApprovalRequest,
  listApprovalQueue,
  approveApprovalRequest,
  rejectApprovalRequest
} from "./db/services/approvals";

// ── Audit & Operations ──────────────────────────────────────
export { listAuditTrail, listOperationsTimeline } from "./db/services/audit";

// ── Environment Variables ────────────────────────────────────
export { upsertEnvironmentVariable, listEnvironmentVariableInventory } from "./db/services/envvars";

// ── Backups & Volumes ────────────────────────────────────────
export {
  listBackupOverview,
  triggerBackupRun,
  queueBackupRestore,
  listBackupRestoreQueue,
  listPersistentVolumeInventory
} from "./db/services/backups";

// ── API Tokens & Principals ─────────────────────────────────
export { listApiTokenInventory, listPrincipalInventory } from "./db/services/tokens";

// ── Encryption Utilities ─────────────────────────────────────
export {
  encrypt as encryptEnvironmentValue,
  decrypt as decryptEnvironmentValue
} from "./db/crypto";

// ── Control Plane Readiness ──────────────────────────────────
export function ensureControlPlaneReady() {
  // With Postgres + Drizzle, the DB is always ready once connected.
  // Seed data is applied via db:push + db:seed scripts.
}
