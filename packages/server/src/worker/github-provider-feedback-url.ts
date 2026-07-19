import type { ProviderFeedbackContext } from "../db/services/provider-feedback-types";
import { resolveVerifiedPreviewUrl } from "./provider-feedback-url";

export { buildDaoFlowDeploymentUrl } from "./provider-feedback-url";

/**
 * A route is publishable only when DaoFlow currently observes the exact hostname
 * mapped to the deployed service as active for the same team.
 */
export async function resolveVerifiedGitHubEnvironmentUrl(input: {
  teamId: string;
  context: ProviderFeedbackContext;
  state: "queued" | "in_progress" | "success" | "failure" | "inactive";
}) {
  return resolveVerifiedPreviewUrl({
    teamId: input.teamId,
    context: input.context,
    includePreviewUrl: input.state === "success"
  });
}
