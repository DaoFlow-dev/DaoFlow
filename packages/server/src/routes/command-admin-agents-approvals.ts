import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest
} from "../db/services/approvals";
import { createAgentPrincipal, generateAgentToken, revokeAgentToken } from "../db/services/agents";
import {
  adminProcedure,
  approvalsCreateProcedure,
  approvalsDecideProcedure,
  getActorContext,
  t,
  throwOnOperationError,
  tokensManageProcedure
} from "../trpc";

export const adminAgentApprovalRouter = t.router({
  createAgent: adminProcedure
    .input(
      z
        .object({
          name: z.string().min(1).max(80),
          description: z.string().max(255).optional(),
          scopes: z.array(z.string()).min(1).optional(),
          preset: z.enum(["agent:read-only", "agent:minimal-write", "agent:full"]).optional()
        })
        .refine((data) => data.scopes || data.preset, {
          message: "Either scopes or preset must be provided"
        })
        .refine((data) => !(data.scopes && data.preset), {
          message: "Provide either scopes or preset, not both"
        })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createAgentPrincipal({
        ...input,
        ...getActorContext(ctx)
      });
      return result.principal;
    }),

  generateAgentToken: tokensManageProcedure
    .input(
      z.object({
        principalId: z.string().min(1),
        tokenName: z.string().min(1).max(80),
        expiresInDays: z.number().int().min(1).max(365).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await generateAgentToken({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found." });
      }
      return { token: result.token, tokenValue: result.tokenValue };
    }),

  revokeAgentToken: tokensManageProcedure
    .input(z.object({ tokenId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await revokeAgentToken({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token not found." });
      }
      return { revoked: true };
    }),

  requestApproval: approvalsCreateProcedure
    .input(
      z.discriminatedUnion("actionType", [
        z.object({
          actionType: z.literal("compose-release"),
          composeServiceId: z.string().min(1),
          commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
          imageTag: z.string().min(1).max(160).optional(),
          reason: z.string().min(12).max(280)
        }),
        z.object({
          actionType: z.literal("backup-restore"),
          backupRunId: z.string().min(1),
          reason: z.string().min(12).max(280)
        })
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const request = await createApprovalRequest({
        ...input,
        ...getActorContext(ctx)
      });

      if (!request) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            input.actionType === "compose-release"
              ? "Compose release target not found."
              : "Only successful backup runs with an artifact can be submitted for approval."
        });
      }

      return request;
    }),

  approveApprovalRequest: approvalsDecideProcedure
    .input(
      z.object({
        requestId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await approveApprovalRequest(
        input.requestId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Approval request");
      return result.request;
    }),

  rejectApprovalRequest: approvalsDecideProcedure
    .input(
      z.object({
        requestId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await rejectApprovalRequest(
        input.requestId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Approval request");
      return result.request;
    })
});
