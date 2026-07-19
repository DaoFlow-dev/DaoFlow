import type { WebhookPushTargetOutcome } from "./webhooks-types";

export type RecoveredWebhookDeployment = {
  id: string;
  serviceName: string;
  sourceType: string;
  imageTag: string | null;
  commitSha: string | null;
  configSnapshot: unknown;
};

export type WebhookTargetCallbacks = {
  shouldProcessTarget?: (targetKey: string) => boolean;
  onTargetStarted?: (input: {
    targetKey: string;
    projectId: string;
    projectName: string;
    serviceId?: string;
  }) => Promise<void>;
  onTargetOutcome?: (outcome: WebhookPushTargetOutcome) => Promise<void>;
  webhookDeliveryId?: string;
  findRecoveredDeployment?: (targetKey: string) => Promise<RecoveredWebhookDeployment | null>;
};
