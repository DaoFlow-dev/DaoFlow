import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { deleteEnvironmentVariable, upsertEnvironmentVariable } from "../db/services/envvars";
import { resolveEnvironmentSecretInventory } from "../db/services/onepassword";
import { resolveTeamIdForUser } from "../db/services/teams";
import {
  envWriteProcedure,
  getDeleteContext,
  getUpdaterContext,
  secretsReadProcedure,
  t
} from "../trpc";

const environmentSecretsInputSchema = z.object({
  environmentId: z.string().min(1)
});

const environmentVariableKeySchema = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]*$/)
  .max(80);

const upsertVariableFields = {
  key: environmentVariableKeySchema,
  value: z.string().min(1).max(4000),
  isSecret: z.boolean(),
  category: z.enum(["runtime", "build"]),
  source: z.enum(["inline", "1password"]).optional(),
  secretRef: z.string().max(500).nullable().optional()
} as const;

const deleteVariableFields = {
  key: environmentVariableKeySchema
} as const;

const upsertEnvironmentVariableInputSchema = z.union([
  z
    .object({
      ...upsertVariableFields,
      projectId: z.string().min(1),
      scope: z.literal("project").optional()
    })
    .strict(),
  z
    .object({
      ...upsertVariableFields,
      environmentId: z.string().min(1),
      scope: z.literal("environment").optional(),
      branchPattern: z.string().max(120).optional()
    })
    .strict(),
  z
    .object({
      ...upsertVariableFields,
      environmentId: z.string().min(1),
      serviceId: z.string().min(1),
      scope: z.literal("service").optional(),
      branchPattern: z.string().max(120).optional()
    })
    .strict()
]);

const deleteEnvironmentVariableInputSchema = z.union([
  z
    .object({
      ...deleteVariableFields,
      projectId: z.string().min(1),
      scope: z.literal("project").optional()
    })
    .strict(),
  z
    .object({
      ...deleteVariableFields,
      environmentId: z.string().min(1),
      scope: z.literal("environment").optional(),
      branchPattern: z.string().max(120).nullable().optional()
    })
    .strict(),
  z
    .object({
      ...deleteVariableFields,
      environmentId: z.string().min(1),
      serviceId: z.string().min(1),
      scope: z.literal("service").optional(),
      branchPattern: z.string().max(120).nullable().optional()
    })
    .strict()
]);

async function requireViewerTeamId(userId: string) {
  const teamId = await resolveTeamIdForUser(userId);

  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization is available for this user."
    });
  }

  return teamId;
}

export const deployEnvironmentCommandRouter = t.router({
  upsertEnvironmentVariable: envWriteProcedure
    .input(upsertEnvironmentVariableInputSchema)
    .mutation(async ({ ctx, input }) => {
      const variable = await upsertEnvironmentVariable({
        ...input,
        ...getUpdaterContext(ctx)
      });

      if (!variable) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment variable target not found."
        });
      }

      return variable;
    }),
  resolveEnvironmentSecrets: secretsReadProcedure
    .input(environmentSecretsInputSchema)
    .query(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      const variables = await resolveEnvironmentSecretInventory(input.environmentId, teamId);

      return {
        ok: true,
        environmentId: input.environmentId,
        resolved: variables.filter((variable) => variable.status === "resolved").length,
        unresolved: variables.filter((variable) => variable.status === "unresolved").length,
        variables
      };
    }),
  deleteEnvironmentVariable: envWriteProcedure
    .input(deleteEnvironmentVariableInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getDeleteContext(ctx);
      const result = await deleteEnvironmentVariable({
        ...input,
        deletedByUserId: actor.userId,
        deletedByEmail: actor.email,
        deletedByRole: actor.role
      });

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Environment variable '${input.key}' was not found in the requested scope.`
        });
      }

      return result;
    })
});
