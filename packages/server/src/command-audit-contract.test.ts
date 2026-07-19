import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import {
  classifyCommandAuditError,
  extractCommandOperationId,
  hashIdempotencyKey,
  successOutcomeForCommand,
  summarizeCommandInput
} from "./db/services/command-audit";
import { appRouter } from "./router";

describe("command audit contract", () => {
  it("covers every mutation exported by the application router", () => {
    const procedures = appRouter._def.procedures as Record<
      string,
      { _def: { type: string; meta?: { commandAudit?: unknown } } }
    >;
    const mutations = Object.entries(procedures).filter(
      ([, procedure]) => procedure._def.type === "mutation"
    );
    const uncovered = mutations
      .filter(([, procedure]) => !procedure._def.meta?.commandAudit)
      .map(([path]) => path);

    expect(mutations.length).toBeGreaterThan(0);
    expect(uncovered).toEqual([]);
  });

  it("summarizes only field names and safe resource identifiers", () => {
    const summary = summarizeCommandInput(
      {
        serviceId: "svc_safe_1",
        value: "database-password",
        privateKey: "private-key-material",
        serviceAccountToken: "secret-token"
      },
      "upsertEnvironmentVariable"
    );
    const serialized = JSON.stringify(summary);

    expect(summary.targetResource).toBe("service/svc_safe_1");
    expect(summary.summary.providedFields).toEqual([
      "privateKey",
      "serviceAccountToken",
      "serviceId",
      "value"
    ]);
    expect(serialized).not.toContain("database-password");
    expect(serialized).not.toContain("private-key-material");
    expect(serialized).not.toContain("secret-token");
  });

  it("hashes idempotency keys instead of storing their raw value", () => {
    const headers = new Headers({ "idempotency-key": "customer-provided-key" });
    const hashed = hashIdempotencyKey(headers);

    expect(hashed).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hashed).not.toContain("customer-provided-key");
  });

  it("keeps validation, authorization, approval, and execution failures distinct", () => {
    expect(
      classifyCommandAuditError(
        new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid input",
          cause: { name: "ZodError", issues: [] }
        })
      )
    ).toBe("validation_failed");
    expect(classifyCommandAuditError(new TRPCError({ code: "FORBIDDEN", message: "Denied" }))).toBe(
      "denied"
    );
    expect(
      classifyCommandAuditError(
        new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Approval is required",
          cause: { code: "APPROVAL_REQUIRED" }
        })
      )
    ).toBe("approval_denied");
    expect(
      classifyCommandAuditError(
        new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Remote command failed" })
      )
    ).toBe("execution_failed");
  });

  it("does not report queued work as remotely succeeded", () => {
    expect(successOutcomeForCommand("triggerDeploy")).toBe("accepted");
    expect(successOutcomeForCommand("queueBackupRestore")).toBe("accepted");
    expect(successOutcomeForCommand("triggerControlPlaneRecoveryBundle")).toBe("accepted");
    expect(successOutcomeForCommand("createManagedDatabase")).toBe("accepted");
    expect(successOutcomeForCommand("updateProject")).toBe("succeeded");
  });

  it("uses the deployment ID instead of an unrelated nested resource ID", () => {
    expect(
      extractCommandOperationId("createManagedDatabase", {
        service: { id: "svc_wrong" },
        deployment: { id: "dep_expected" }
      })
    ).toBe("dep_expected");
  });

  it("uses the recovery bundle ID for queued recovery dispatch auditing", () => {
    expect(
      extractCommandOperationId("triggerControlPlaneRecoveryBundle", {
        bundle: { id: "rb_expected" },
        destination: { id: "dest_wrong" }
      })
    ).toBe("rb_expected");
  });
});
