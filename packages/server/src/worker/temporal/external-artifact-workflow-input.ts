export interface ExternalArtifactRestoreApprovalSnapshot {
  artifactId: string;
  artifactSha256: string;
  artifactObjectKey: string;
  artifactObjectVersion: string;
  artifactObjectEtag: string;
  artifactVerifiedAt: string;
  destinationId: string;
  destinationUpdatedAt: string;
  targetVolumeId: string;
  targetVolumeUpdatedAt: string;
  targetServerId: string;
  targetMountPath: string;
  targetServiceId: string;
  targetServiceUpdatedAt: string;
  runtimeServiceName: string;
  databaseEngine: "postgres";
  databaseName: string;
  databaseUser: string;
  secretPolicy: "destination-credentials-encrypted";
}

export interface ExternalArtifactRestoreApproval {
  approvalRequestId: string;
  expectedTeamId: string;
  snapshot: ExternalArtifactRestoreApprovalSnapshot;
}

export interface ExternalArtifactImportWorkflowInput {
  artifactId: string;
  destinationUpdatedAt: string;
}

export interface ExternalArtifactVerificationWorkflowInput {
  artifactId: string;
  restoreId: string;
}

export interface ExternalArtifactRestoreWorkflowInput {
  artifactId: string;
  restoreId: string;
  targetVolumeId: string;
  approval: ExternalArtifactRestoreApproval;
}
