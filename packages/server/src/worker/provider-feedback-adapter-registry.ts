import type { ClaimedProviderFeedback } from "../db/services/provider-feedback-claims";
import type {
  ProviderFeedbackContext,
  ProviderFeedbackExternalIds
} from "../db/services/provider-feedback-types";

export interface ProviderFeedbackAdapterInput {
  feedbackId: string;
  targetId: string;
  idempotencyKey: string;
  teamId: string;
  deploymentId: string;
  transition: string;
  provider: {
    id: string;
    kind: string;
  };
  context: ProviderFeedbackContext;
  externalIds: Required<ProviderFeedbackExternalIds>;
  attemptCount: number;
  signal: AbortSignal;
}

export interface ProviderFeedbackAdapter {
  providerKind: string;
  upsertFeedback(input: ProviderFeedbackAdapterInput): Promise<ProviderFeedbackExternalIds | void>;
}

const adapters = new Map<string, ProviderFeedbackAdapter>();

function normalizeProviderKind(providerKind: string) {
  return providerKind.trim().toLowerCase();
}

function toAdapterInput(
  feedback: ClaimedProviderFeedback,
  signal: AbortSignal
): ProviderFeedbackAdapterInput {
  return {
    feedbackId: feedback.id,
    targetId: feedback.targetId,
    idempotencyKey: feedback.idempotencyKey,
    teamId: feedback.teamId,
    deploymentId: feedback.deploymentId,
    transition: feedback.transition,
    provider: {
      id: feedback.providerId,
      kind: feedback.providerKind
    },
    context: feedback.context as ProviderFeedbackContext,
    externalIds: feedback.externalIds,
    attemptCount: feedback.attemptCount,
    signal
  };
}

export function registerProviderFeedbackAdapter(adapter: ProviderFeedbackAdapter) {
  const providerKind = normalizeProviderKind(adapter.providerKind);
  if (!providerKind) throw new Error("Provider feedback adapters need a provider kind.");
  adapters.set(providerKind, adapter);
  return () => adapters.delete(providerKind);
}

export function getProviderFeedbackAdapter(providerKind: string) {
  return adapters.get(normalizeProviderKind(providerKind)) ?? null;
}

export function listRegisteredProviderFeedbackKinds() {
  return [...adapters.keys()];
}

export async function deliverProviderFeedback(
  adapter: ProviderFeedbackAdapter,
  feedback: ClaimedProviderFeedback,
  signal: AbortSignal
) {
  return adapter.upsertFeedback(toAdapterInput(feedback, signal));
}

export function resetProviderFeedbackAdaptersForTests() {
  adapters.clear();
}
