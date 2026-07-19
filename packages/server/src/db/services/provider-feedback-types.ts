export const providerFeedbackStates = ["pending", "retrying", "delivered", "dead-letter"] as const;

export type ProviderFeedbackState = (typeof providerFeedbackStates)[number];

export interface ProviderFeedbackExternalIds {
  externalDeploymentId?: string | null;
  externalStatusId?: string | null;
  externalCommentId?: string | null;
}

export interface ProviderFeedbackPreviewContext {
  target: "branch" | "pull-request" | null;
  action: "deploy" | "destroy" | null;
  key: string | null;
  branch: string | null;
  pullRequestNumber: number | null;
  primaryDomain: string | null;
}

/**
 * Immutable, credential-free provider targeting data captured at the deployment
 * transition. Future adapters must use this instead of mutable project settings.
 */
export interface ProviderFeedbackContext {
  schemaVersion: 1;
  project: {
    id: string;
    name: string;
  };
  repository: {
    fullName: string | null;
    installationId: string | null;
  };
  deployment: {
    commitSha: string | null;
    branch: string | null;
    serviceName?: string | null;
    environmentId: string;
    environmentName: string;
    environmentSlug: string;
  };
  preview: ProviderFeedbackPreviewContext | null;
}

export interface ProviderFeedbackFailure {
  retryable: boolean;
  safeMessage: string;
  retryAfterMs?: number;
}
