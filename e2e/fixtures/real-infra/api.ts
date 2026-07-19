import { expect, type Page } from "@playwright/test";

const QUERY_PROCEDURES = new Set([
  "auditTrail",
  "backupRestoreQueue",
  "backupRunDetails",
  "deploymentDetails",
  "deploymentLogs",
  "eventTimeline"
]);

type TrpcEnvelope<T> = {
  result?: { data?: { json?: T } & T };
};

function unwrap<T>(payload: unknown): T {
  const envelope = payload as TrpcEnvelope<T>;
  if (envelope.result?.data && "json" in envelope.result.data) {
    return envelope.result.data.json as T;
  }
  if (envelope.result?.data) return envelope.result.data as T;
  return payload as T;
}

export async function realInfraTrpc<T>(
  page: Page,
  procedure: string,
  input?: Record<string, unknown>
): Promise<T> {
  const query = QUERY_PROCEDURES.has(procedure);
  const response = await page.evaluate(
    async ({ procedureName, procedureInput, isQuery }) => {
      const search =
        isQuery && procedureInput
          ? `?input=${encodeURIComponent(JSON.stringify(procedureInput))}`
          : "";
      const result = await fetch(`/trpc/${procedureName}${search}`, {
        method: procedureInput && !isQuery ? "POST" : "GET",
        headers: procedureInput && !isQuery ? { "Content-Type": "application/json" } : undefined,
        body: procedureInput && !isQuery ? JSON.stringify(procedureInput) : undefined,
        credentials: "include"
      });
      return {
        ok: result.ok,
        status: result.status,
        payload: await result.json().catch(() => null)
      };
    },
    { procedureName: procedure, procedureInput: input ?? null, isQuery: query }
  );
  if (!response.ok) {
    throw new Error(`Control-plane procedure ${procedure} failed with HTTP ${response.status}.`);
  }
  return unwrap<T>(response.payload);
}

export async function uploadCompose(
  page: Page,
  input: { serverId: string; project?: string; environment: string; compose: string }
) {
  const response = await page.evaluate(async (payload) => {
    const result = await fetch("/api/v1/deploy/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        server: payload.serverId,
        project: payload.project,
        environment: payload.environment,
        compose: payload.compose
      })
    });
    return { ok: result.ok, status: result.status, payload: await result.json().catch(() => null) };
  }, input);
  const payload = response.payload as Record<string, unknown> | null;
  if (
    !response.ok ||
    !payload ||
    typeof payload.deploymentId !== "string" ||
    typeof payload.serviceId !== "string"
  ) {
    const detail =
      payload && typeof payload.error === "string"
        ? payload.error
        : payload && typeof payload.message === "string"
          ? payload.message
          : "The server did not return a deployment.";
    throw new Error(`Direct Compose upload failed with HTTP ${response.status}. ${detail}`);
  }
  return {
    deploymentId: payload.deploymentId,
    projectId: typeof payload.projectId === "string" ? payload.projectId : "",
    environmentId: typeof payload.environmentId === "string" ? payload.environmentId : "",
    serviceId: payload.serviceId
  };
}

export async function waitForDeployment(
  page: Page,
  deploymentId: string,
  expectedStatus: "healthy" | "failed"
): Promise<Record<string, unknown>> {
  let details: Record<string, unknown> | null = null;
  await expect
    .poll(
      async () => {
        details = await realInfraTrpc<Record<string, unknown>>(page, "deploymentDetails", {
          deploymentId
        });
        const status = details.status;
        const conclusion = details.conclusion;
        if (
          expectedStatus === "healthy" &&
          (status === "failed" || conclusion === "failed" || conclusion === "cancelled")
        ) {
          throw new Error(
            `Deployment reached a failed terminal state. ${deploymentFailureReason(details)}`
          );
        }
        if (expectedStatus === "healthy" && status === "completed" && conclusion === "succeeded") {
          return "healthy";
        }
        return status;
      },
      { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }
    )
    .toBe(expectedStatus);
  if (!details) throw new Error("Deployment details were unavailable after status polling.");
  return details as Record<string, unknown>;
}

function deploymentFailureReason(details: Record<string, unknown>): string {
  const guidance = asRecord(details.recoveryGuidance);
  const health = asRecord(details.healthSummary);
  const error = asRecord(details.error);
  for (const value of [
    guidance.suspectedRootCause,
    guidance.summary,
    health.failureAnalysis,
    error.message,
    error.reason
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  }
  return "No persisted failure reason was returned.";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function waitForBackupRun(
  page: Page,
  runId: string,
  expectedStatus: string
): Promise<Record<string, unknown>> {
  let details: Record<string, unknown> | null = null;
  await expect
    .poll(
      async () => {
        details = await realInfraTrpc<Record<string, unknown>>(page, "backupRunDetails", { runId });
        if (expectedStatus === "succeeded" && details.status === "failed") {
          throw new Error(
            `Backup reached a failed terminal state. ${backupFailureReason(details)}`
          );
        }
        return details.status;
      },
      { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }
    )
    .toBe(expectedStatus);
  if (!details) throw new Error("Backup details were unavailable after status polling.");
  return details as Record<string, unknown>;
}

export async function waitForRestore(page: Page, restoreId: string) {
  await expect
    .poll(
      async () => {
        const queue = await realInfraTrpc<{ requests?: Array<{ id?: string; status?: string }> }>(
          page,
          "backupRestoreQueue",
          { limit: 50 }
        );
        return queue.requests?.find((request) => request.id === restoreId)?.status ?? null;
      },
      { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }
    )
    .toBe("succeeded");
}

function backupFailureReason(details: Record<string, unknown>): string {
  if (typeof details.error === "string" && details.error.trim()) {
    return details.error.trim().slice(0, 500);
  }
  const entries = Array.isArray(details.logEntries) ? details.logEntries : [];
  for (const entry of entries.toReversed()) {
    const message = asRecord(entry).message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 500);
  }
  return "No persisted failure reason was returned.";
}
