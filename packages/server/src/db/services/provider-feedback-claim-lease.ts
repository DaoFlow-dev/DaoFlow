import { and, eq, gt, sql } from "drizzle-orm";
import { providerFeedback, providerFeedbackTargets } from "../schema/provider-feedback";
import type { ProviderFeedbackTransaction } from "./provider-feedback-intents";

export async function requireActiveProviderFeedbackClaim(
  tx: ProviderFeedbackTransaction,
  input: { feedbackId: string; leaseToken: string; now?: Date }
) {
  const [claimed] = await tx
    .select({ feedback: providerFeedback, target: providerFeedbackTargets })
    .from(providerFeedback)
    .innerJoin(providerFeedbackTargets, eq(providerFeedbackTargets.id, providerFeedback.targetId))
    .where(eq(providerFeedback.id, input.feedbackId))
    .limit(1)
    .for("update");
  const validationNow = input.now ?? (await readDatabaseClock(tx));
  if (
    !claimed ||
    claimed.feedback.leaseToken !== input.leaseToken ||
    claimed.target.leaseToken !== input.leaseToken ||
    !claimed.feedback.leaseExpiresAt ||
    !claimed.target.leaseExpiresAt ||
    claimed.feedback.leaseExpiresAt.getTime() <= validationNow.getTime() ||
    claimed.target.leaseExpiresAt.getTime() <= validationNow.getTime()
  ) {
    return null;
  }
  return { ...claimed, validationNow };
}

async function readDatabaseClock(tx: ProviderFeedbackTransaction) {
  const result = await tx.execute(sql`select clock_timestamp() as now`);
  const value = result.rows[0]?.now;
  const now = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(now.getTime())) {
    throw new Error("Unable to read the database clock for provider feedback lease validation.");
  }
  return now;
}

type ActiveProviderFeedbackClaim = NonNullable<
  Awaited<ReturnType<typeof requireActiveProviderFeedbackClaim>>
>;

export function activeProviderFeedbackClaimWhere(claimed: ActiveProviderFeedbackClaim) {
  return and(
    eq(providerFeedback.id, claimed.feedback.id),
    eq(providerFeedback.leaseToken, claimed.feedback.leaseToken ?? ""),
    gt(providerFeedback.leaseExpiresAt, claimed.validationNow)
  );
}

export function activeProviderFeedbackTargetClaimWhere(claimed: ActiveProviderFeedbackClaim) {
  return and(
    eq(providerFeedbackTargets.id, claimed.target.id),
    eq(providerFeedbackTargets.leaseToken, claimed.target.leaseToken ?? ""),
    gt(providerFeedbackTargets.leaseExpiresAt, claimed.validationNow)
  );
}
