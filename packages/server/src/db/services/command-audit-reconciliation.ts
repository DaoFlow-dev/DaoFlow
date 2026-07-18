import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { deployments } from "../schema/deployments";
import { asRecord, readString } from "./json-helpers";

interface IncompleteCommandAuditQuery {
  now?: Date;
  graceMs?: number;
  limit?: number;
}

async function listIncompleteCommandAuditCandidates(input?: IncompleteCommandAuditQuery) {
  const now = input?.now ?? new Date();
  const graceMs = input?.graceMs ?? 5 * 60 * 1000;
  const limit = Math.max(1, Math.min(input?.limit ?? 100, 500));
  const candidates = await db
    .select()
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.outcome, "attempted"),
        lte(auditEntries.createdAt, new Date(now.getTime() - graceMs)),
        sql`${auditEntries.metadata}->>'immutable' = 'true'`,
        sql`${auditEntries.metadata}->>'phase' = 'intent'`,
        sql`NOT EXISTS (
          SELECT 1
          FROM "audit_entries" AS terminal
          WHERE terminal."metadata"->>'attemptId' = ${auditEntries.metadata}->>'attemptId'
            AND terminal."metadata"->>'phase' = 'outcome'
        )`
      )
    )
    .limit(limit);

  return { now, candidates };
}

export async function countIncompleteCommandAudits(
  input?: IncompleteCommandAuditQuery
): Promise<number> {
  const { candidates } = await listIncompleteCommandAuditCandidates(input);
  return candidates.length;
}

export async function reconcileIncompleteCommandAudits(
  input?: IncompleteCommandAuditQuery
): Promise<{ eligibleCount: number; reconciledCount: number }> {
  const { now, candidates } = await listIncompleteCommandAuditCandidates(input);
  let reconciledCount = 0;

  for (const candidate of candidates) {
    const metadata = asRecord(candidate.metadata);
    const attemptId = readString(metadata, "attemptId");
    if (!attemptId) {
      continue;
    }

    const [[deployment], [acceptance]] = await Promise.all([
      db
        .select({
          id: deployments.id,
          status: deployments.status,
          conclusion: deployments.conclusion
        })
        .from(deployments)
        .where(sql`${deployments.configSnapshot}->>'commandAuditAttemptId' = ${attemptId}`)
        .limit(1),
      db
        .select({ id: auditEntries.id })
        .from(auditEntries)
        .where(
          and(
            sql`${auditEntries.metadata}->>'attemptId' = ${attemptId}`,
            sql`${auditEntries.metadata}->>'phase' = 'acceptance'`
          )
        )
        .limit(1)
    ]);
    const failed =
      deployment?.status === "failed" ||
      deployment?.status === "cancelled" ||
      deployment?.conclusion === "failed" ||
      deployment?.conclusion === "cancelled";
    const succeeded = deployment?.conclusion === "succeeded";
    const outcome = deployment
      ? succeeded
        ? "succeeded"
        : failed
          ? "execution_failed"
          : "accepted"
      : acceptance
        ? null
        : "incomplete";
    if (!outcome || (outcome === "accepted" && acceptance)) {
      continue;
    }

    const phase = outcome === "accepted" ? "acceptance" : "outcome";
    const inserted = await db
      .insert(auditEntries)
      .values({
        actorType: "system",
        actorId: "system:command-audit-reconciler",
        actorEmail: "system@daoflow.local",
        actorRole: "admin",
        organizationId: candidate.organizationId,
        targetResource: deployment ? `deployment/${deployment.id}` : candidate.targetResource,
        action: candidate.action,
        inputSummary: deployment
          ? `Reconciled command audit from deployment ${deployment.id} (${deployment.status}).`
          : "No terminal command outcome was persisted before the reconciliation window.",
        permissionScope: candidate.permissionScope,
        outcome,
        metadata: {
          immutable: true,
          commandAuditVersion: 1,
          attemptId,
          phase,
          requestId: metadata.requestId ?? null,
          operationId: deployment?.id ?? null,
          operationStatus: deployment?.status ?? null,
          operationConclusion: deployment?.conclusion ?? null,
          reconciledAt: now.toISOString()
        },
        createdAt: now
      })
      .onConflictDoNothing()
      .returning({ id: auditEntries.id });
    reconciledCount += inserted.length;
  }

  return { eligibleCount: candidates.length, reconciledCount };
}
