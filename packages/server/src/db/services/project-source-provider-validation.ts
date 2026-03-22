import type { ProjectSourceValidationResult } from "./project-source-readiness";
import type { ProviderLinkedProjectSource } from "./project-source-readiness";
import { validateGitHubSource } from "./project-source-provider-validation-github";
import { validateGitLabSource } from "./project-source-provider-validation-gitlab";
import type { GitProviderValidationRecord } from "./project-source-provider-validation-shared";

export async function validateProviderLinkedProjectSource(
  provider: GitProviderValidationRecord,
  source: ProviderLinkedProjectSource
): Promise<ProjectSourceValidationResult> {
  if (provider.type === "github") {
    return validateGitHubSource(provider, source);
  }

  if (provider.type === "gitlab") {
    return validateGitLabSource(provider, source);
  }

  return {
    status: "invalid",
    message: `Unsupported git provider type: ${provider.type}`,
    readiness: null
  };
}
