export interface RestoreApproval {
  approvalRequestId: string;
  expectedTeamId: string;
}

export interface RestoreWorkflowInput {
  /** Existing queued restore row to execute */
  restoreId?: string;
  /** ID of the backup run to restore from (#24: point-in-time by run ID) */
  backupRunId: string;
  /** Target path override (optional) */
  targetPath?: string;
  /** Who triggered the restore */
  triggeredBy: string;
  /** If true, restore to temp and verify, then cleanup (#21: test restore) */
  testRestore?: boolean;
  /** Explicit mode for new workflow histories; testRestore remains for replay compatibility. */
  mode?: "restore" | "verification";
  /** Approval binding that Temporal durably carries to the execution worker. */
  approval?: RestoreApproval;
}
