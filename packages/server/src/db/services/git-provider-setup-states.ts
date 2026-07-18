import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../connection";
import { gitProviderSetupStates } from "../schema/git-providers";

export const GIT_PROVIDER_SETUP_STATE_TTL_MS = 10 * 60 * 1000;

export type GitProviderSetupAction = "github_manifest" | "github_installation" | "gitlab_oauth";

export type GitProviderSetupType = "github" | "gitlab";

function newSetupStateId() {
  return randomBytes(16).toString("hex");
}

export async function createGitProviderSetupState(input: {
  teamId: string;
  providerId?: string | null;
  providerType: GitProviderSetupType;
  action: GitProviderSetupAction;
  callbackOrigin: string;
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
        eq(gitProviderSetupStates.initiatedByUserId, input.initiatedByUserId),
        gt(gitProviderSetupStates.expiresAt, now),
        isNull(gitProviderSetupStates.consumedAt)
      )
    )
    .returning();

  return setup ?? null;
}
