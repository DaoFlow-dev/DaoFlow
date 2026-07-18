import type { CommandActionContext } from "./command-action";
import type { InstallOptionSources } from "./install-config-types";
import type { InstallerRuntime } from "./installer-lifecycle";
import {
  INSTALL_WORKFLOW_PROFILE_CHOICES,
  parseInstallWorkflowProfile,
  type InstallWorkflowProfile
} from "./install-workflow-profile";

export function resolveRequestedInstallWorkflowProfile(input: {
  value: string | undefined;
  ctx: CommandActionContext;
}): InstallWorkflowProfile {
  const profile = parseInstallWorkflowProfile(input.value ?? "lean");
  if (!profile) {
    input.ctx.fail(`Invalid workflow profile "${input.value}". Use one of: lean, temporal.`, {
      code: "INVALID_WORKFLOW_PROFILE"
    });
  }
  return profile;
}

export async function promptForInstallWorkflowProfile(input: {
  runtime: Pick<InstallerRuntime, "promptSelect">;
  sources: InstallOptionSources;
  requestedProfile: InstallWorkflowProfile;
  existingProfile?: InstallWorkflowProfile;
}): Promise<InstallWorkflowProfile> {
  if (input.sources.hasExplicitWorkflowProfile) return input.requestedProfile;

  return input.runtime.promptSelect(
    "Workflow profile",
    INSTALL_WORKFLOW_PROFILE_CHOICES,
    input.existingProfile ?? input.requestedProfile
  );
}
