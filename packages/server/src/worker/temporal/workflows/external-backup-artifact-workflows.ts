import { proxyActivities } from "@temporalio/workflow";
import type * as externalArtifactActivities from "../activities/external-backup-artifact-activities";
import type {
  ExternalArtifactImportWorkflowInput,
  ExternalArtifactRestoreWorkflowInput,
  ExternalArtifactVerificationWorkflowInput
} from "../external-artifact-workflow-input";

const { importExternalBackupArtifact, verifyExternalBackupArtifact } = proxyActivities<
  typeof externalArtifactActivities
>({
  startToCloseTimeout: "60 minutes",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: "30s",
    maximumInterval: "5m"
  },
  heartbeatTimeout: "2 minutes"
});

const { executeExternalArtifactRestore } = proxyActivities<typeof externalArtifactActivities>({
  startToCloseTimeout: "60 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 1 }
});

export async function externalArtifactImportWorkflow(
  input: ExternalArtifactImportWorkflowInput
): Promise<void> {
  await importExternalBackupArtifact(input);
}

export async function externalArtifactVerificationWorkflow(
  input: ExternalArtifactVerificationWorkflowInput
): Promise<void> {
  await verifyExternalBackupArtifact(input);
}

export async function externalArtifactRestoreWorkflow(
  input: ExternalArtifactRestoreWorkflowInput
): Promise<void> {
  await executeExternalArtifactRestore(input);
}
