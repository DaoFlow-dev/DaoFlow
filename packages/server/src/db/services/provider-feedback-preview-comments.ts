import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../connection";
import { providerFeedbackPreviewComments } from "../schema/provider-feedback";
import { newId } from "./json-helpers";

const DEFAULT_PREVIEW_COMMENT_LEASE_MS = 2 * 60_000;
type PreviewCommentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ProviderFeedbackPreviewCommentIdentity {
  teamId: string;
  projectId: string;
  providerId: string;
  repositoryFullName: string;
  pullRequestNumber: number;
}

export type ClaimedProviderFeedbackPreviewComment =
  typeof providerFeedbackPreviewComments.$inferSelect & {
    leaseToken: string;
  };

function identityWhere(input: ProviderFeedbackPreviewCommentIdentity) {
  return and(
    eq(providerFeedbackPreviewComments.teamId, input.teamId),
    eq(providerFeedbackPreviewComments.projectId, input.projectId),
    eq(providerFeedbackPreviewComments.repositoryFullName, input.repositoryFullName),
    eq(providerFeedbackPreviewComments.pullRequestNumber, input.pullRequestNumber)
  );
}

async function readDatabaseClock(tx: PreviewCommentTransaction) {
  const result = await tx.execute(sql`select clock_timestamp() as now`);
  const value = result.rows[0]?.now;
  const now = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(now.getTime())) {
    throw new Error("Unable to read the database clock for preview comment lease validation.");
  }
  return now;
}

function activeLease(row: typeof providerFeedbackPreviewComments.$inferSelect, now: Date) {
  return Boolean(
    row.leaseToken && row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now.getTime()
  );
}

/**
 * Claims the one external preview comment identity while an adapter performs
 * its remote read/write sequence. The lock is intentionally separate from the
 * deployment feedback target because multiple deployments share this comment.
 */
export async function claimProviderFeedbackPreviewComment(
  input: ProviderFeedbackPreviewCommentIdentity & {
    now?: Date;
    leaseDurationMs?: number;
  }
): Promise<ClaimedProviderFeedbackPreviewComment | null> {
  const leaseToken = newId();

  return db.transaction(async (tx) => {
    const insertNow = input.now ?? (await readDatabaseClock(tx));
    await tx
      .insert(providerFeedbackPreviewComments)
      .values({
        id: newId(),
        teamId: input.teamId,
        projectId: input.projectId,
        providerId: input.providerId,
        repositoryFullName: input.repositoryFullName,
        pullRequestNumber: input.pullRequestNumber,
        createdAt: insertNow,
        updatedAt: insertNow
      })
      .onConflictDoNothing({
        target: [
          providerFeedbackPreviewComments.projectId,
          providerFeedbackPreviewComments.repositoryFullName,
          providerFeedbackPreviewComments.pullRequestNumber
        ]
      });

    const [current] = await tx
      .select()
      .from(providerFeedbackPreviewComments)
      .where(identityWhere(input))
      .limit(1)
      .for("update");
    const now = input.now ?? (await readDatabaseClock(tx));
    if (!current || activeLease(current, now)) return null;
    const leaseExpiresAt = new Date(
      now.getTime() + (input.leaseDurationMs ?? DEFAULT_PREVIEW_COMMENT_LEASE_MS)
    );
    const [claimed] = await tx
      .update(providerFeedbackPreviewComments)
      .set({
        providerId: input.providerId,
        externalCommentId:
          current.providerId === input.providerId ? current.externalCommentId : null,
        leaseToken,
        leaseExpiresAt,
        updatedAt: now
      })
      .where(and(eq(providerFeedbackPreviewComments.id, current.id), identityWhere(input)))
      .returning();

    return claimed ? { ...claimed, leaseToken } : null;
  });
}

/** Persists a recovered external comment ID and releases the comment lease. */
export async function releaseProviderFeedbackPreviewComment(input: {
  commentId: string;
  leaseToken: string;
  externalCommentId?: string | null;
  now?: Date;
}) {
  const externalCommentId = input.externalCommentId?.trim() || undefined;
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(providerFeedbackPreviewComments)
      .where(eq(providerFeedbackPreviewComments.id, input.commentId))
      .limit(1)
      .for("update");
    const now = input.now ?? (await readDatabaseClock(tx));
    if (!current || current.leaseToken !== input.leaseToken || !activeLease(current, now)) {
      return false;
    }

    const [released] = await tx
      .update(providerFeedbackPreviewComments)
      .set({
        ...(externalCommentId ? { externalCommentId } : {}),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now
      })
      .where(
        and(
          eq(providerFeedbackPreviewComments.id, input.commentId),
          eq(providerFeedbackPreviewComments.leaseToken, input.leaseToken),
          gt(providerFeedbackPreviewComments.leaseExpiresAt, now)
        )
      )
      .returning({ id: providerFeedbackPreviewComments.id });

    return Boolean(released);
  });
}

export async function renewProviderFeedbackPreviewComment(input: {
  commentId: string;
  leaseToken: string;
  now?: Date;
  leaseDurationMs?: number;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(providerFeedbackPreviewComments)
      .where(eq(providerFeedbackPreviewComments.id, input.commentId))
      .limit(1)
      .for("update");
    const now = input.now ?? (await readDatabaseClock(tx));
    if (!current || current.leaseToken !== input.leaseToken || !activeLease(current, now)) {
      return false;
    }

    const leaseExpiresAt = new Date(
      now.getTime() + (input.leaseDurationMs ?? DEFAULT_PREVIEW_COMMENT_LEASE_MS)
    );
    const [renewed] = await tx
      .update(providerFeedbackPreviewComments)
      .set({ leaseExpiresAt, updatedAt: now })
      .where(
        and(
          eq(providerFeedbackPreviewComments.id, input.commentId),
          eq(providerFeedbackPreviewComments.leaseToken, input.leaseToken),
          gt(providerFeedbackPreviewComments.leaseExpiresAt, now)
        )
      )
      .returning({ id: providerFeedbackPreviewComments.id });
    return Boolean(renewed);
  });
}
