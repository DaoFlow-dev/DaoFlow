import type { InstallerRuntime } from "./installer-lifecycle";
import type { InstallWorkflowProfile } from "./install-workflow-profile";
import {
  installWorkflowStepMessage,
  runInstallWorkflow,
  type InstallWorkflowProfileChange
} from "./install-workflow-runtime";

interface WorkflowSpinner {
  text: string;
  succeed(message?: string): unknown;
  fail(message?: string): unknown;
}

export async function runInstallWorkflowWithProgress(input: {
  runtime: Pick<InstallerRuntime, "exec" | "sleep">;
  dir: string;
  envPath: string;
  existingWorkflowProfile: InstallWorkflowProfile | null;
  workflowProfile: InstallWorkflowProfile;
  skipTemporalCleanup: boolean;
  spinner: WorkflowSpinner | null;
}): Promise<{
  imagePullFailed: boolean;
  workflowProfileChange: InstallWorkflowProfileChange | null;
}> {
  try {
    const workflow = await runInstallWorkflow({
      runtime: input.runtime,
      dir: input.dir,
      envPath: input.envPath,
      existingWorkflowProfile: input.existingWorkflowProfile,
      workflowProfile: input.workflowProfile,
      skipTemporalCleanup: input.skipTemporalCleanup,
      onStep: (step) => {
        if (input.spinner) input.spinner.text = installWorkflowStepMessage(step);
      }
    });
    input.spinner?.succeed(
      workflow.imagePullFailed
        ? "DaoFlow services started; image pull will be retried by Docker"
        : "DaoFlow services started"
    );
    return workflow;
  } catch (error) {
    input.spinner?.fail("Failed to prepare services");
    throw error;
  }
}
