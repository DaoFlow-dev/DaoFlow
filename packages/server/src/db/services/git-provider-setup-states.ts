import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { gitProviderSetupStates } from "../schema/git-providers";

export const GIT_PROVIDER_SETUP_STATE_TTL_MS = 10 * 60 * 1000;

export type GitProviderSetupAction = "github_manifest" | "github_installation" | "gitlab_oauth";

export type GitProviderSetupType = "github" | "gitlab";

function newSetupStateId() {
  return randomBytes(16).toString("hex");
}

export function createGitLabPkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function createGitProviderSetupState(input: {
  teamId: string;
  providerId?: string | null;
  providerType: GitProviderSetupType;
  action: GitProviderSetupAction;
  callbackOrigin: string;
  providerPublicBaseUrl?: string | null;
  codeVerifier?: string | null;
  initiatedByUserId: string;
  expiresAt?: Date;
}) {
  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + GIT_PROVIDER_SETUP_STATE_TTL_MS);
  const id = newSetupStateId();

  const [state] = await db
    .insert(gitProviderSetupStates)
    .values({
      id,
      teamId: input.teamId,
      providerId: input.providerId ?? null,
      providerType: input.providerType,
      action: input.action,
      callbackOrigin: input.callbackOrigin,
      providerPublicBaseUrl: input.providerPublicBaseUrl ?? null,
      codeVerifierEncrypted: input.codeVerifier ? encrypt(input.codeVerifier) : null,
      initiatedByUserId: input.initiatedByUserId,
      expiresAt
    })
    .returning();

  if (!state) {
    throw new Error("Expected Git provider setup state write to return a row.");
  }

  return state;
}

/**
 * Consume a state with one conditional update so concurrent callbacks cannot both succeed.
 */
export async function consumeGitProviderSetupState(input: {
  state: string;
  providerType: GitProviderSetupType;
  action: GitProviderSetupAction;
  callbackOrigin: string;
  providerPublicBaseUrl?: string | null;
  initiatedByUserId: string;
}) {
  const now = new Date();
  const [setup] = await db
    .update(gitProviderSetupStates)
    .set({ consumedAt: now })
    .where(
      and(
        eq(gitProviderSetupStates.id, input.state),
        eq(gitProviderSetupStates.providerType, input.providerType),
        eq(gitProviderSetupStates.action, input.action),
        eq(gitProviderSetupStates.callbackOrigin, input.callbackOrigin),
        ...(input.providerPublicBaseUrl
          ? [eq(gitProviderSetupStates.providerPublicBaseUrl, input.providerPublicBaseUrl)]
          : []),
        eq(gitProviderSetupStates.initiatedByUserId, input.initiatedByUserId),
        gt(gitProviderSetupStates.expiresAt, now),
        isNull(gitProviderSetupStates.consumedAt)
      )
    )
    .returning();

  return setup ?? null;
}

export function readGitProviderSetupStateCodeVerifier(
  setup: Pick<typeof gitProviderSetupStates.$inferSelect, "codeVerifierEncrypted">
): string | null {
  if (!setup.codeVerifierEncrypted) return null;
  try {
    return decrypt(setup.codeVerifierEncrypted);
  } catch {
    return null;
  }
}
