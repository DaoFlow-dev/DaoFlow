/**
 * Minimal typed contract for the subset of DaoFlow tRPC procedures the MCP
 * server exposes.
 *
 * Like the CLI, the MCP package keeps a local contract surface instead of
 * importing `@daoflow/server`, so the binary stays decoupled from the control
 * plane implementation. Outputs are typed as `unknown` because every tool simply
 * serializes the result to JSON; inputs are typed precisely so tool handlers
 * cannot pass malformed payloads.
 */
import type { AnyRouter } from "@trpc/server";

type QueryArgs<TInput> = [TInput] extends [void] ? [] | [TInput?] : [TInput];

interface Query<TInput = void> {
  query(...args: QueryArgs<TInput>): Promise<unknown>;
}

interface Mutation<TInput> {
  mutate(input: TInput): Promise<unknown>;
}

export type DaoFlowRouterBase = AnyRouter;

export interface EnvironmentVariableInput {
  environmentId: string;
  key: string;
  value: string;
  isSecret: boolean;
  category: "runtime" | "build";
}

export interface DaoFlowMcpClient {
  // ── Read lane ──────────────────────────────────────────────
  viewer: Query;
  serverReadiness: Query<{ limit?: number }>;
  projects: Query<{ limit?: number }>;
  projectDetails: Query<{ projectId: string }>;
  services: Query<{ environmentId?: string; limit?: number }>;
  serviceDetails: Query<{ serviceId: string }>;
  deploymentDetails: Query<{ deploymentId: string }>;
  deploymentLogs: Query<{
    deploymentId?: string;
    service?: string;
    query?: string;
    stream?: "all" | "stdout" | "stderr";
    limit?: number;
  }>;
  eventTimeline: Query<{ limit?: number; since?: string; kind?: string; severity?: string }>;
  auditTrail: Query<{ limit?: number; since?: string }>;
  backupOverview: Query<{ limit?: number }>;
  persistentVolumes: Query<{ limit?: number }>;
  rollbackTargets: Query<{ serviceId: string }>;
  composeDriftReport: Query<{ limit?: number }>;
  configDiff: Query<{ deploymentIdA: string; deploymentIdB: string }>;
  approvalQueue: Query<{ limit?: number }>;

  // ── Planning lane ──────────────────────────────────────────
  deploymentPlan: Query<{ service: string; server?: string; image?: string }>;
  rollbackPlan: Query<{ service: string; target?: string }>;
  backupRestorePlan: Query<{ backupRunId: string }>;

  // ── Command lane (mutating) ────────────────────────────────
  triggerDeploy: Mutation<{ serviceId: string; commitSha?: string; imageTag?: string }>;
  executeRollback: Mutation<{ serviceId: string; targetDeploymentId: string }>;
  cancelDeployment: Mutation<{ deploymentId: string }>;
  triggerBackupNow: Mutation<{ policyId: string }>;
  queueBackupRestore: Mutation<{ backupRunId: string }>;
  upsertEnvironmentVariable: Mutation<EnvironmentVariableInput>;
  approveApprovalRequest: Mutation<{ requestId: string }>;
}
